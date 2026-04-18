import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LmService } from './lmService';
import { DiaryStore } from '../storage/diaryStore';
import { CriticalFlag, CriticalSeverity } from '../models/criticalFlag';
import { getRelativePath, getWorkspaceCwd } from '../utils/git';
import { validLineRange, isValidSeverity, stripJsonFences, truncateText } from '../utils/validation';

const FILE_SYSTEM_PROMPT = `You are a security-minded code reviewer helping a developer understand an existing file. Your job is to find the regions a new developer MUST understand before modifying this code.

Analyze the file and flag regions that fall into these categories:

SECURITY (always flag):
- Filesystem operations with user-controlled paths (path traversal risk)
- Input from external callers that is not validated/sanitized
- Authentication, authorization, token handling
- Cryptographic operations
- PII or sensitive data handling

RELIABILITY (flag when non-trivial):
- External API calls, network operations, timeout handling
- Concurrency, shared state, race conditions
- Error handling that silently swallows failures
- Resource cleanup (connections, file handles, goroutines)

BUSINESS LOGIC (flag when consequences are serious):
- Financial calculations, billing, payment logic
- Rate limiting, quota enforcement
- Data mutations (writes, deletes, state transitions)
- Complex domain rules not obvious from reading the code

For each region, respond with a JSON array entry:
- "line_start": number
- "line_end": number
- "severity": "critical" | "high" | "medium"
- "description": one sentence: what the risk is, and what could go wrong

It is better to flag something that turns out to be fine than to miss a real issue. If the file has no issues at all, return []. But most production code has at least one region worth flagging.

Respond with ONLY the JSON array.`;

interface DetectedRegion {
  file: string;
  line_start: number;
  line_end: number;
  severity: CriticalSeverity;
  description: string;
}

export class CriticalDetector {
  constructor(
    private lm: LmService,
    private store: DiaryStore,
  ) {}

  /**
   * Full-file critical-region scan on the active editor. Interactive: results
   * are shown in a quick pick so the user can dismiss noise before persisting.
   */
  async scanFileContent(editor: vscode.TextEditor): Promise<void> {
    const filePath = getRelativePath(editor.document.uri);
    if (!filePath) { return; }

    const content = editor.document.getText();
    const numbered = content
      .split('\n')
      .map((line, i) => `${i + 1}: ${line}`)
      .join('\n');

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `CodeDiary: Scanning ${filePath} for critical regions...`,
        cancellable: true,
      },
      async (progress, token) => {
        try {
          progress.report({ message: 'Connecting to language model...' });

          const result = await this.lm.generate(
            FILE_SYSTEM_PROMPT,
            `<file path="${filePath}">\n${numbered}\n</file>`,
            token,
          );
          if (!result || token.isCancellationRequested) { return; }

          progress.report({ message: `Analyzing with ${result.modelName}...` });

          const regions = this.parseRegions(result.text, filePath).filter(r => r.file === filePath);

          if (regions.length === 0) {
            vscode.window.showInformationMessage(
              `CodeDiary: No critical regions detected in ${filePath} (via ${result.modelName}).`,
            );
            return;
          }

          const items = regions.map(r => ({
            label: `$(shield) ${r.severity}: ${truncateText(r.description, 70)}`,
            description: `${r.file} L${r.line_start}-${r.line_end}`,
            picked: true,
            region: r,
          }));

          const selected = await vscode.window.showQuickPick(items, {
            canPickMany: true,
            placeHolder: 'Select critical regions to flag (uncheck to dismiss)',
            title: `${regions.length} critical regions detected — ${result.modelName}`,
          });

          if (!selected || selected.length === 0) { return; }

          for (const item of selected) {
            this.store.addCriticalFlag({
              file: item.region.file,
              line_start: item.region.line_start,
              line_end: item.region.line_end,
              severity: item.region.severity,
              description: item.region.description,
              human_reviewed: false,
            });
          }

          vscode.window.showInformationMessage(
            `CodeDiary: ${selected.length} critical regions flagged in ${filePath} (via ${result.modelName}).`,
          );
        } catch (err) {
          vscode.window.showErrorMessage(`CodeDiary: Failed to scan for critical regions: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    );
  }

  /**
   * Batch full-file critical scan over many files. Auto-flags every detected
   * region with `human_reviewed: false` — no per-region quick pick. Used by
   * scanComponent / scanProject; the human reviews via the Critical Queue.
   */
  async scanFiles(filePaths: string[], scopeLabel: string): Promise<void> {
    const cwd = getWorkspaceCwd();
    if (!cwd || filePaths.length === 0) { return; }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `CodeDiary: Critical scan — ${scopeLabel}`,
        cancellable: true,
      },
      async (progress, token) => {
        let flagged = 0;
        let scanned = 0;
        let modelName = '';
        const increment = 100 / filePaths.length;

        for (const filePath of filePaths) {
          if (token.isCancellationRequested) { break; }
          progress.report({ message: `(${scanned + 1}/${filePaths.length}) ${filePath}`, increment });

          try {
            const abs = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
            if (!fs.existsSync(abs)) { scanned++; continue; }
            const content = fs.readFileSync(abs, 'utf8');
            if (!content.trim()) { scanned++; continue; }
            const numbered = content
              .split('\n')
              .map((line, i) => `${i + 1}: ${line}`)
              .join('\n');

            const result = await this.lm.generate(
              FILE_SYSTEM_PROMPT,
              `<file path="${filePath}">\n${numbered}\n</file>`,
              token,
            );
            if (!result) { scanned++; continue; }
            modelName = result.modelName;

            const regions = this.parseRegions(result.text, filePath).filter(r => r.file === filePath);
            for (const r of regions) {
              this.store.addCriticalFlag({
                file: r.file,
                line_start: r.line_start,
                line_end: r.line_end,
                severity: r.severity,
                description: r.description,
                human_reviewed: false,
              });
              flagged++;
            }
          } catch {
            // Skip individual file failures so one bad file doesn't abort the batch.
          }
          scanned++;
        }

        const via = modelName ? ` (via ${modelName})` : '';
        vscode.window.showInformationMessage(
          `CodeDiary: ${flagged} critical regions flagged across ${scanned} files${via}. Review in the Critical Queue.`,
        );
      },
    );
  }

  private parseRegions(raw: string, defaultFile?: string): DetectedRegion[] {
    try {
      const cleaned = stripJsonFences(raw);
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) { return []; }
      const results: DetectedRegion[] = [];
      for (const r of parsed) {
        if (!r || typeof r !== 'object') { continue; }
        const range = validLineRange(r.line_start, r.line_end);
        if (!range) { continue; }
        if (!isValidSeverity(r.severity)) { continue; }
        if (typeof r.description !== 'string' || !r.description.trim()) { continue; }
        results.push({
          file: typeof r.file === 'string' ? r.file : (defaultFile || 'unknown'),
          line_start: range.line_start,
          line_end: range.line_end,
          severity: r.severity,
          description: r.description.trim(),
        });
      }
      return results;
    } catch {
      return [];
    }
  }
}
