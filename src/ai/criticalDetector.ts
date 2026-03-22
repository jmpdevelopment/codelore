import * as vscode from 'vscode';
import { LmService } from './lmService';
import { DiaryStore } from '../storage/diaryStore';
import { CriticalFlag, CriticalSeverity } from '../models/criticalFlag';
import { getRelativePath, getWorkspaceCwd, gitDiff, gitDiffAll } from '../utils/git';
import { validLineRange, isValidSeverity, stripJsonFences, truncateText } from '../utils/validation';

const DIFF_SYSTEM_PROMPT = `You are a code safety reviewer. Given a code diff, identify regions that are high-risk and should not be shipped without careful human review.

Focus on:
- Authentication and authorization logic
- Payment, billing, and financial calculations
- Database migrations and schema changes
- Cryptographic operations
- PII and sensitive data handling
- Infrastructure and deployment configuration
- Error handling in critical paths
- Behavioral changes that could break callers (return value changes, side effect changes)
- Cross-file impact where a change here could affect critical behavior elsewhere

Respond with a JSON array. Each entry has:
- "file": the file path from the diff
- "line_start": starting line number in the new file
- "line_end": ending line number
- "severity": "critical", "high", or "medium"
- "description": one sentence explaining WHY this is critical

Only flag genuinely important regions. If nothing is critical, return an empty array [].
Respond ONLY with the JSON array, no markdown fences or explanation.`;

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

  async scanCurrentFile(editor: vscode.TextEditor): Promise<void> {
    const filePath = getRelativePath(editor.document.uri);
    if (!filePath) { return; }

    const cwd = getWorkspaceCwd();
    if (!cwd) { return; }

    const diff = gitDiff(filePath, cwd);
    if (!diff) {
      vscode.window.showInformationMessage('CodeDiary: No changes detected for this file.');
      return;
    }

    await this.scan({
      systemPrompt: DIFF_SYSTEM_PROMPT,
      prompt: `<file path="${filePath}">\n<diff>\n${diff}\n</diff>\n</file>`,
      limitToFiles: [filePath],
      mode: 'diff',
      target: filePath,
    });
  }

  async scanAllChanges(): Promise<void> {
    const cwd = getWorkspaceCwd();
    if (!cwd) { return; }

    const diff = gitDiffAll(cwd);
    if (!diff) {
      vscode.window.showInformationMessage('CodeDiary: No uncommitted changes found.');
      return;
    }

    await this.scan({
      systemPrompt: DIFF_SYSTEM_PROMPT,
      prompt: `<diff>\n${diff}\n</diff>`,
      mode: 'diff',
      target: 'all uncommitted changes',
    });
  }

  async scanFileContent(editor: vscode.TextEditor): Promise<void> {
    const filePath = getRelativePath(editor.document.uri);
    if (!filePath) { return; }

    const content = editor.document.getText();
    const numbered = content
      .split('\n')
      .map((line, i) => `${i + 1}: ${line}`)
      .join('\n');

    await this.scan({
      systemPrompt: FILE_SYSTEM_PROMPT,
      prompt: `<file path="${filePath}">\n${numbered}\n</file>`,
      limitToFiles: [filePath],
      mode: 'file',
      target: filePath,
    });
  }

  private async scan(opts: {
    systemPrompt: string;
    prompt: string;
    limitToFiles?: string[];
    mode: 'diff' | 'file';
    target: string;
  }): Promise<void> {
    const modeLabel = opts.mode === 'diff' ? 'Scanning changes in' : 'Scanning full file';

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `CodeDiary: ${modeLabel} ${opts.target}...`,
        cancellable: true,
      },
      async (progress, token) => {
        try {
          progress.report({ message: 'Connecting to language model...' });

          const result = await this.lm.generate(opts.systemPrompt, opts.prompt, token);
          if (!result || token.isCancellationRequested) { return; }

          progress.report({ message: `Analyzing with ${result.modelName}...` });

          const defaultFile = opts.limitToFiles?.length === 1 ? opts.limitToFiles[0] : undefined;
          const regions = this.parseRegions(result.text, defaultFile);
          const filtered = opts.limitToFiles
            ? regions.filter(r => opts.limitToFiles!.includes(r.file))
            : regions;

          if (filtered.length === 0) {
            vscode.window.showInformationMessage(
              `CodeDiary: No critical regions detected in ${opts.target} (via ${result.modelName}).`,
            );
            return;
          }

          // Show what was found, let user confirm
          const items = filtered.map(r => ({
            label: `$(shield) ${r.severity}: ${truncateText(r.description, 70)}`,
            description: `${r.file} L${r.line_start}-${r.line_end}`,
            picked: true,
            region: r,
          }));

          const modeDescription = opts.mode === 'diff'
            ? 'detected in changed code'
            : 'detected in existing code';

          const selected = await vscode.window.showQuickPick(items, {
            canPickMany: true,
            placeHolder: 'Select critical regions to flag (uncheck to dismiss)',
            title: `${filtered.length} critical regions ${modeDescription} — ${result.modelName}`,
          });

          if (!selected || selected.length === 0) { return; }

          for (const item of selected) {
            const flag: CriticalFlag = {
              file: item.region.file,
              line_start: item.region.line_start,
              line_end: item.region.line_end,
              severity: item.region.severity,
              description: item.region.description,
              human_reviewed: false,
            };
            this.store.addCriticalFlag(flag);
          }

          vscode.window.showInformationMessage(
            `CodeDiary: ${selected.length} critical regions flagged in ${opts.target} (via ${result.modelName}).`,
          );
        } catch (err) {
          vscode.window.showErrorMessage(`CodeDiary: Failed to scan for critical regions: ${err instanceof Error ? err.message : String(err)}`);
        }
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
