import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LmService } from './lmService';
import { LoreStore } from '../storage/loreStore';
import { Annotation, AnnotationCategory, CATEGORY_META, FileDependency } from '../models/annotation';
import { CriticalFlag, CriticalSeverity } from '../models/criticalFlag';
import { Component } from '../models/component';
import { v4 as uuidv4 } from 'uuid';
import { getGitUser, getRelativePath, getWorkspaceCwd } from '../utils/git';
import {
  validLineRange,
  isValidKnowledgeCategory,
  isValidSeverity,
  isSafeRelativePath,
  stripJsonFences,
  truncateText,
} from '../utils/validation';

/** Validate and extract dependency entries from AI-generated JSON. */
function parseDependencies(raw: unknown): FileDependency[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) { return undefined; }
  const deps: FileDependency[] = [];
  for (const d of raw) {
    if (!d || typeof d !== 'object') { continue; }
    if (typeof d.file !== 'string' || !d.file.trim()) { continue; }
    const file = d.file.trim();
    if (!isSafeRelativePath(file)) { continue; }
    const range = (d.line_start !== undefined || d.line_end !== undefined)
      ? validLineRange(d.line_start, d.line_end)
      : undefined;
    deps.push({
      file,
      relationship: typeof d.relationship === 'string' ? d.relationship.trim() : 'related',
      line_start: range?.line_start,
      line_end: range?.line_end,
    });
  }
  return deps.length > 0 ? deps : undefined;
}

/**
 * Keep only ids that name a real component. Unknown ids from the model are
 * silently dropped — we'd rather a missing tag than a dangling reference.
 */
function parseComponentTags(raw: unknown, knownIds: Set<string>): string[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) { return undefined; }
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && knownIds.has(v) && !out.includes(v)) { out.push(v); }
  }
  return out.length > 0 ? out : undefined;
}

const SYSTEM_PROMPT = `You are CodeLore, the primary author of institutional knowledge for this codebase. A human teammate will review your entries afterwards — your job is to write high-signal notes they would otherwise have to reverse-engineer from the source, plus flag regions that are genuinely dangerous.

You are given: a file path, the full file content (line-numbered), any existing annotations and critical flags, and (when available) the component subsystems this file belongs to. Use all of it.

Produce TWO lists in a single pass:
- "annotations": notes future readers need (invariants, non-obvious behavior, rationale, gotchas, etc.)
- "critical_flags": regions where a wrong modification could cause real harm (security, data loss, correctness)

Respond ONLY with a single JSON object (no markdown fences, no prose), shaped as:
{
  "annotations": [ { ...annotation entry } ],
  "critical_flags": [ { ...critical flag entry } ]
}

Each annotation entry has:
- "category": one of "behavior" | "rationale" | "constraint" | "gotcha" | "business_rule" | "performance" | "security" | "human_note"
- "line_start": starting line number in the file (1-based, from the numbered content)
- "line_end": ending line number
- "text": 1–2 sentences, concrete, written for a teammate who has not seen this code
- "components": (optional) array of component ids — use only ids listed under <components>; drop the field if none apply
- "dependencies": (optional) array of cross-file coupling links, e.g. [{"file": "src/billing/calc.ts", "relationship": "must stay in sync"}]

Category guide:
- "behavior": non-obvious runtime behavior a reader would otherwise miss
- "rationale": why this was built this way — decisions, rejected alternatives, historical context
- "constraint": invariant, precondition, or postcondition required for correctness
- "gotcha": footgun, counterintuitive quirk, or known hazard — proceed with care
- "business_rule": domain rule / regulatory requirement — don't change without stakeholder sign-off
- "performance": hot path, complexity assumption, benchmark-sensitive region
- "security": trust boundary, auth assumption, sanitization requirement
- "human_note": free-form observation when nothing else fits

Each critical flag has:
- "line_start": starting line
- "line_end": ending line
- "severity": "critical" | "high" | "medium"
- "description": one sentence — what the risk is and what could go wrong

Flag quality rules (important — default to NOT flagging):
- If a defense is visible in the same file (validator, sanitizer, symlink/path check, realpath, allow-list), do NOT flag that risk. Describe the defense in an annotation instead if it's non-obvious.
- Do NOT flag architectural patterns that are intentional throughout the codebase (e.g., sending file contents to a language model in an AI-powered extension). Only flag a boundary if it introduces NEW trust assumptions.
- Do NOT flag error-handling style (empty catch, silent failures) as critical unless it causes data loss or security failure. A noisy-log preference is not a critical flag.
- Do NOT re-flag issues already present in the existing_knowledge block.

Aim for a small number of dense, high-signal entries in each list. Empty arrays are fine — return { "annotations": [], "critical_flags": [] } when nothing is worth saying.

Component tagging: if the file is already tagged into components, default to tagging your annotations with the same ids when relevant. Tag only ids visible under <components>.`;

interface SuggestedEntry {
  category: AnnotationCategory;
  line_start: number;
  line_end: number;
  text: string;
  dependencies?: FileDependency[];
  components?: string[];
}

interface DetectedRegion {
  line_start: number;
  line_end: number;
  severity: CriticalSeverity;
  description: string;
}

export interface ScanOutput {
  entries: SuggestedEntry[];
  flags: DetectedRegion[];
}

export class LoreGenerator {
  constructor(
    private lm: LmService,
    private store: LoreStore,
  ) {}

  /**
   * Interactive full-file scan: one model call produces both annotation
   * suggestions and critical-flag suggestions. The user reviews annotations
   * and flags in two sequential quick picks so each set can be curated
   * independently before persistence.
   */
  async scanFile(editor: vscode.TextEditor): Promise<void> {
    const filePath = getRelativePath(editor.document.uri);
    if (!filePath) { return; }
    const fileContent = editor.document.getText();
    if (!fileContent.trim()) {
      vscode.window.showInformationMessage('CodeLore: File is empty.');
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `CodeLore: Scanning ${filePath}...`,
        cancellable: true,
      },
      async (progress, token) => {
        try {
          progress.report({ message: 'Connecting to language model...' });

          const prompt = this.buildPrompt(filePath, fileContent);
          const result = await this.lm.generate(SYSTEM_PROMPT, prompt, token);
          if (!result || token.isCancellationRequested) { return; }

          progress.report({ message: `Analyzing with ${result.modelName}...` });

          const output = this.parseScanOutput(result.text);
          if (output.entries.length === 0 && output.flags.length === 0) {
            vscode.window.showInformationMessage(
              `CodeLore: Nothing surfaced for ${filePath} (via ${result.modelName}).`,
            );
            return;
          }

          await this.presentEntries(filePath, output.entries, result.modelName);
          await this.presentFlags(filePath, output.flags, result.modelName);
        } catch (err) {
          vscode.window.showErrorMessage(
            `CodeLore: Scan failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    );
  }

  /**
   * Batch full-file scan over many files. Auto-accepts every parsed entry
   * and flag — no per-item quick pick. Used by scanComponent / scanProject;
   * the human reviews via the sidebar / Critical Queue afterwards.
   */
  async scanFiles(filePaths: string[], scopeLabel: string): Promise<void> {
    const cwd = getWorkspaceCwd();
    if (!cwd || filePaths.length === 0) { return; }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `CodeLore: Scanning — ${scopeLabel}`,
        cancellable: true,
      },
      async (progress, token) => {
        let addedEntries = 0;
        let addedFlags = 0;
        let scanned = 0;
        let modelName = '';
        const increment = 100 / filePaths.length;

        for (const filePath of filePaths) {
          if (token.isCancellationRequested) { break; }
          progress.report({ message: `(${scanned + 1}/${filePaths.length}) ${filePath}`, increment });

          try {
            const abs = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
            if (!fs.existsSync(abs)) { scanned++; continue; }
            const fileContent = fs.readFileSync(abs, 'utf8');
            if (!fileContent.trim()) { scanned++; continue; }

            const prompt = this.buildPrompt(filePath, fileContent);
            const result = await this.lm.generate(SYSTEM_PROMPT, prompt, token);
            if (!result) { scanned++; continue; }
            modelName = result.modelName;

            const output = this.parseScanOutput(result.text);
            for (const entry of output.entries) {
              this.addAsSuggested(filePath, entry);
              addedEntries++;
            }
            for (const region of output.flags) {
              this.store.addCriticalFlag({
                file: filePath,
                line_start: region.line_start,
                line_end: region.line_end,
                severity: region.severity,
                description: region.description,
                human_reviewed: false,
              });
              addedFlags++;
            }
          } catch {
            // Skip individual file failures so one bad file doesn't abort the batch.
          }
          scanned++;
        }

        const via = modelName ? ` (via ${modelName})` : '';
        vscode.window.showInformationMessage(
          `CodeLore: ${addedEntries} knowledge entries, ${addedFlags} critical flags added across ${scanned} files${via}. Review in the sidebar.`,
        );
      },
    );
  }

  private buildPrompt(filePath: string, fileContent: string): string {
    const existingContext = this.formatExistingKnowledge(filePath);
    const componentContext = this.formatComponentContext(filePath);
    return `<file path="${filePath}">\n<scope>full-file scan — cover the entire file, surface both annotations and critical flags</scope>\n<content>\n${this.numberLines(fileContent)}\n</content>\n</file>${componentContext}${existingContext}`;
  }

  private async presentEntries(filePath: string, entries: SuggestedEntry[], modelName: string): Promise<void> {
    if (entries.length === 0) { return; }

    const items = entries.map((entry) => {
      const overlapping = this.store.findOverlapping(filePath, entry.line_start, entry.line_end);
      const overlapNote = overlapping.length > 0 ? ` (replaces ${overlapping.length} existing)` : '';
      return {
        label: truncateText(entry.text, 70),
        description: `L${entry.line_start}-${entry.line_end} · ${entry.category}${overlapNote}`,
        picked: overlapping.length === 0,
        entry,
        overlapping,
      };
    });

    const selected = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: 'Select knowledge entries to keep (uncheck to dismiss). Overlapping entries replace existing.',
      title: `${entries.length} suggested entries for ${filePath} — ${modelName}`,
    });

    if (!selected || selected.length === 0) { return; }

    let added = 0;
    let replaced = 0;
    for (const item of selected) {
      for (const existing of item.overlapping) {
        if (existing.source !== 'human_authored') {
          this.store.deleteAnnotation(existing.id);
          replaced++;
        }
      }
      this.addAsSuggested(filePath, item.entry);
      added++;
    }

    const replaceMsg = replaced > 0 ? ` (replaced ${replaced} older entries)` : '';
    vscode.window.showInformationMessage(`CodeLore: ${added} knowledge entries added${replaceMsg}.`);
  }

  private async presentFlags(filePath: string, flags: DetectedRegion[], modelName: string): Promise<void> {
    if (flags.length === 0) { return; }

    const items = flags.map((region) => ({
      label: `$(shield) ${region.severity}: ${truncateText(region.description, 70)}`,
      description: `L${region.line_start}-${region.line_end}`,
      picked: true,
      region,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: 'Select critical regions to flag (uncheck to dismiss)',
      title: `${flags.length} critical regions detected — ${modelName}`,
    });

    if (!selected || selected.length === 0) { return; }

    for (const item of selected) {
      this.store.addCriticalFlag({
        file: filePath,
        line_start: item.region.line_start,
        line_end: item.region.line_end,
        severity: item.region.severity,
        description: item.region.description,
        human_reviewed: false,
      });
    }

    vscode.window.showInformationMessage(
      `CodeLore: ${selected.length} critical regions flagged in ${filePath}.`,
    );
  }

  private addAsSuggested(filePath: string, entry: SuggestedEntry): void {
    const annotation: Annotation = {
      id: uuidv4(),
      file: filePath,
      line_start: entry.line_start,
      line_end: entry.line_end,
      category: entry.category,
      text: entry.text,
      source: 'ai_generated',
      created_at: new Date().toISOString(),
      author: getGitUser(),
      dependencies: entry.dependencies && entry.dependencies.length > 0 ? entry.dependencies : undefined,
      components: entry.components && entry.components.length > 0 ? entry.components : undefined,
    };
    this.store.addAnnotation(annotation);
  }

  /**
   * Parse a unified scan response of shape
   * `{ annotations: [...], critical_flags: [...] }`. Returns empty arrays
   * on any parse failure or schema mismatch — callers treat that the same
   * as "model had nothing to say" per the prompt contract.
   */
  parseScanOutput(raw: string): ScanOutput {
    try {
      const cleaned = stripJsonFences(raw);
      const parsed = JSON.parse(cleaned);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { entries: [], flags: [] };
      }
      return {
        entries: this.parseEntries(parsed.annotations),
        flags: this.parseFlags(parsed.critical_flags),
      };
    } catch {
      return { entries: [], flags: [] };
    }
  }

  private parseEntries(raw: unknown): SuggestedEntry[] {
    if (!Array.isArray(raw)) { return []; }
    const knownComponentIds = new Set(this.store.getComponents().map(c => c.id));
    const results: SuggestedEntry[] = [];
    for (const e of raw) {
      if (!e || typeof e !== 'object') { continue; }
      const range = validLineRange(e.line_start, e.line_end);
      if (!range) { continue; }
      if (!isValidKnowledgeCategory(e.category)) { continue; }
      if (typeof e.text !== 'string' || !e.text.trim()) { continue; }
      results.push({
        category: e.category,
        line_start: range.line_start,
        line_end: range.line_end,
        text: e.text.trim(),
        dependencies: parseDependencies(e.dependencies),
        components: parseComponentTags(e.components, knownComponentIds),
      });
    }
    return results;
  }

  private parseFlags(raw: unknown): DetectedRegion[] {
    if (!Array.isArray(raw)) { return []; }
    const results: DetectedRegion[] = [];
    for (const r of raw) {
      if (!r || typeof r !== 'object') { continue; }
      const range = validLineRange(r.line_start, r.line_end);
      if (!range) { continue; }
      if (!isValidSeverity(r.severity)) { continue; }
      if (typeof r.description !== 'string' || !r.description.trim()) { continue; }
      results.push({
        line_start: range.line_start,
        line_end: range.line_end,
        severity: r.severity,
        description: r.description.trim(),
      });
    }
    return results;
  }

  /**
   * Per-file component block: lists the components this file is tagged into
   * plus sibling files inside them, so the model can tag new entries with
   * the same component ids. Empty string when the file is untagged.
   */
  formatComponentContext(filePath: string): string {
    const mine = this.store.getComponentsForFile(filePath);
    if (mine.length === 0) { return ''; }
    const lines: string[] = ['\n\n<components>'];
    lines.push('This file is tagged into the following component(s). Tag entries with these ids when relevant.');
    for (const c of mine) {
      lines.push(this.renderComponentBlock(c, filePath));
    }
    lines.push('</components>');
    return lines.join('\n');
  }

  private renderComponentBlock(component: Component, currentFile: string): string {
    const lines = [`- ${component.id} (${component.name})`];
    if (component.description) { lines.push(`  description: ${component.description}`); }
    const siblings = component.files.filter(f => f !== currentFile).slice(0, 8);
    if (siblings.length > 0) {
      lines.push(`  other files: ${siblings.join(', ')}${component.files.length - 1 > siblings.length ? ', …' : ''}`);
    }
    return lines.join('\n');
  }

  formatExistingKnowledge(filePath: string): string {
    // Only include shared annotations in AI context — personal notes stay private
    const annotations = this.store.shared.getAnnotationsForFile(filePath);
    const criticalFlags = this.store.shared.getCriticalFlagsForFile(filePath);

    if (annotations.length === 0 && criticalFlags.length === 0) {
      return '';
    }

    const parts: string[] = ['\n\n<existing_knowledge>'];

    if (annotations.length > 0) {
      parts.push('Existing annotations for this file:');
      for (const a of annotations) {
        parts.push(`- L${a.line_start}-${a.line_end} [${CATEGORY_META[a.category].label}]: ${a.text}`);
      }
    }

    if (criticalFlags.length > 0) {
      parts.push('Existing critical flags for this file:');
      for (const f of criticalFlags) {
        const status = f.human_reviewed ? 'reviewed' : 'unreviewed';
        parts.push(`- L${f.line_start}-${f.line_end} [${f.severity}, ${status}]: ${f.description || 'No description'}`);
      }
    }

    parts.push('</existing_knowledge>');
    return parts.join('\n');
  }

  private numberLines(content: string): string {
    return content
      .split('\n')
      .map((line, i) => `${i + 1}: ${line}`)
      .join('\n');
  }
}
