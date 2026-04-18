import * as vscode from 'vscode';
import { LmService } from './lmService';
import { LoreStore } from '../storage/loreStore';
import { Component, isValidComponentId, slugify } from '../models/component';
import { getGitUser, getWorkspaceCwd, gitChangedFiles } from '../utils/git';
import { stripJsonFences } from '../utils/validation';

/**
 * AI-driven component authoring. The human partitions rarely; the model
 * reads file paths, proposes subsystem groupings, and writes them back as
 * `source: ai_generated` components that a human can then edit or accept.
 *
 * The proposer does NOT inspect file contents — just paths. That keeps the
 * prompt small enough to send hundreds of files at once and works uniformly
 * across languages. File names alone carry most of the subsystem signal
 * (folder structure, naming conventions).
 */

export interface ProposedComponent {
  id: string;
  name: string;
  description?: string;
  files: string[];
}

const MAX_WORKSPACE_FILES = 200;
const SOURCE_INCLUDE_GLOB = '**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,rs,java,kt,swift,rb,php,cs,cpp,cc,c,h,hpp,sh}';
const SOURCE_EXCLUDE_GLOB = '**/{node_modules,.git,dist,build,out,coverage,.next,.turbo,vendor}/**';

/**
 * First-run fallback when there are no git changes and no annotations yet.
 * Capped at MAX_WORKSPACE_FILES because the prompt sends every path; larger
 * workspaces should partition by folder instead of proposing globally.
 */
async function gatherWorkspaceSourceFiles(): Promise<string[]> {
  const uris = await vscode.workspace.findFiles(SOURCE_INCLUDE_GLOB, SOURCE_EXCLUDE_GLOB, MAX_WORKSPACE_FILES + 1);
  const paths = uris
    .map(uri => vscode.workspace.asRelativePath(uri, false))
    .sort();
  if (paths.length > MAX_WORKSPACE_FILES) {
    vscode.window.showWarningMessage(
      `CodeLore: Workspace has more than ${MAX_WORKSPACE_FILES} source files. Proposing from the first ${MAX_WORKSPACE_FILES} — edit components afterwards, or propose per-folder.`,
    );
    return paths.slice(0, MAX_WORKSPACE_FILES);
  }
  return paths;
}

const SYSTEM_PROMPT = `You are CodeLore, proposing component groupings for a codebase. A "component" is a coherent subsystem a developer would recognize as a unit (e.g., "Billing", "Auth", "Search Indexing").

You are given a flat list of source file paths plus the component definitions that already exist (do not duplicate these). Partition the files into 3–10 proposed components. Each file may belong to at most one component; files that do not cleanly fit any subsystem should be left out. Do not invent files that are not in the list.

Respond ONLY with a JSON array (no markdown fences, no prose). Each entry:
- "id": lowercase kebab-case identifier (e.g., "billing-engine")
- "name": human-readable display name
- "description": one sentence (optional)
- "files": array of file paths copied verbatim from the input list

Prefer folder-structure signal and naming conventions. Skip configuration, build artifacts, and obvious test files unless they form their own component.`;

export class ComponentProposer {
  constructor(
    private lm: LmService,
    private store: LoreStore,
  ) {}

  async propose(): Promise<void> {
    const files = await this.gatherCandidateFiles();
    if (files.length === 0) {
      vscode.window.showInformationMessage(
        'CodeLore: No candidate files found. Make some changes or open a workspace with source files.',
      );
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `CodeLore: Proposing components for ${files.length} files...`,
        cancellable: true,
      },
      async (progress, token) => {
        try {
          progress.report({ message: 'Connecting to language model...' });

          const existingIds = new Set(this.store.getComponents().map(c => c.id));
          const existingContext = this.formatExistingComponents();
          const prompt = `<files>\n${files.map(f => `- ${f}`).join('\n')}\n</files>${existingContext}`;
          const result = await this.lm.generate(SYSTEM_PROMPT, prompt, token);
          if (!result || token.isCancellationRequested) { return; }

          progress.report({ message: `Parsing proposals from ${result.modelName}...` });

          const proposals = this.parseProposals(result.text, new Set(files), existingIds);
          if (proposals.length === 0) {
            vscode.window.showInformationMessage(
              `CodeLore: No component proposals surfaced (via ${result.modelName}).`,
            );
            return;
          }

          await this.presentProposals(proposals, result.modelName);
        } catch (err) {
          vscode.window.showErrorMessage(
            `CodeLore: Component proposal failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    );
  }

  /**
   * Candidate set is the uncommitted changes (most actionable entry point); if
   * there are none, falls back to files already referenced by annotations; if
   * still empty, falls back to workspace source files (first-run bootstrap,
   * capped at MAX_WORKSPACE_FILES to keep the prompt small enough to send).
   */
  async gatherCandidateFiles(): Promise<string[]> {
    const cwd = getWorkspaceCwd();
    if (!cwd) { return []; }
    const changed = gitChangedFiles(cwd).filter(f => f.trim().length > 0);
    if (changed.length > 0) { return changed.sort(); }
    const annotated = new Set<string>();
    for (const a of this.store.getAnnotations()) { annotated.add(a.file); }
    for (const f of this.store.getCriticalFlags()) { annotated.add(f.file); }
    if (annotated.size > 0) { return [...annotated].sort(); }
    return await gatherWorkspaceSourceFiles();
  }

  formatExistingComponents(): string {
    const existing = this.store.getComponents();
    if (existing.length === 0) { return ''; }
    const lines: string[] = ['\n\n<existing_components>'];
    for (const c of existing) {
      const fileCount = c.files.length;
      lines.push(`- ${c.id} (${c.name}) — ${fileCount} file${fileCount === 1 ? '' : 's'}`);
    }
    lines.push('</existing_components>');
    return lines.join('\n');
  }

  parseProposals(raw: string, validFiles: Set<string>, existingIds: Set<string>): ProposedComponent[] {
    try {
      const cleaned = stripJsonFences(raw);
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) { return []; }
      const out: ProposedComponent[] = [];
      const seenIds = new Set<string>();
      for (const p of parsed) {
        if (!p || typeof p !== 'object') { continue; }
        const nameRaw = typeof p.name === 'string' ? p.name.trim() : '';
        if (!nameRaw) { continue; }
        let id = typeof p.id === 'string' ? p.id.trim() : '';
        if (!isValidComponentId(id)) { id = slugify(nameRaw); }
        if (!isValidComponentId(id)) { continue; }
        if (existingIds.has(id) || seenIds.has(id)) { continue; }
        const files: string[] = Array.isArray(p.files)
          ? (p.files as unknown[]).filter(
              (f): f is string => typeof f === 'string' && validFiles.has(f),
            )
          : [];
        if (files.length === 0) { continue; }
        seenIds.add(id);
        out.push({
          id,
          name: nameRaw,
          description: typeof p.description === 'string' && p.description.trim()
            ? p.description.trim()
            : undefined,
          files: [...new Set<string>(files)],
        });
      }
      return out;
    } catch {
      return [];
    }
  }

  private async presentProposals(proposals: ProposedComponent[], modelName: string): Promise<void> {
    const items = proposals.map(p => ({
      label: `$(symbol-namespace) ${p.name}`,
      description: `${p.id} · ${p.files.length} files`,
      detail: p.description ?? '',
      picked: true,
      proposal: p,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: 'Select component proposals to accept (uncheck to discard).',
      title: `${proposals.length} component proposals — ${modelName}`,
    });
    if (!selected || selected.length === 0) { return; }

    const now = new Date().toISOString();
    const author = getGitUser();
    let accepted = 0;
    for (const item of selected) {
      const p = item.proposal;
      const component: Component = {
        id: p.id,
        name: p.name,
        description: p.description,
        files: p.files,
        source: 'ai_generated',
        created_at: now,
        updated_at: now,
        author,
      };
      this.store.components.upsert(component);
      accepted++;
    }
    vscode.window.showInformationMessage(
      `CodeLore: Accepted ${accepted} component proposal${accepted === 1 ? '' : 's'}. Edit them from the Components sidebar.`,
    );
  }
}
