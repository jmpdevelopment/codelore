import * as vscode from 'vscode';
import { execFileSync } from 'child_process';

export function getGitUser(): string {
  try {
    return execFileSync('git', ['config', 'user.name'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export function getRelativePath(uri: vscode.Uri): string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) { return undefined; }
  return vscode.workspace.asRelativePath(uri, false);
}

export function getWorkspaceCwd(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function gitDiff(filePath: string, cwd: string): string | undefined {
  try {
    const diff = execFileSync('git', ['diff', 'HEAD', '--', filePath], { cwd, encoding: 'utf8' });
    if (!diff.trim()) {
      const unstaged = execFileSync('git', ['diff', '--', filePath], { cwd, encoding: 'utf8' });
      return unstaged.trim() || undefined;
    }
    return diff.trim();
  } catch {
    return undefined;
  }
}

export function gitDiffAll(cwd: string): string | undefined {
  try {
    const diff = execFileSync('git', ['diff', 'HEAD'], { cwd, encoding: 'utf8' });
    return diff.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Returns list of files with uncommitted changes (staged + unstaged vs HEAD). */
export function gitChangedFiles(cwd: string): string[] {
  try {
    const output = execFileSync('git', ['diff', 'HEAD', '--name-only'], { cwd, encoding: 'utf8' });
    if (!output.trim()) {
      // Fallback: unstaged changes only (no commits yet or comparing working tree)
      const unstaged = execFileSync('git', ['diff', '--name-only'], { cwd, encoding: 'utf8' });
      return unstaged.trim() ? unstaged.trim().split('\n') : [];
    }
    return output.trim().split('\n');
  } catch {
    return [];
  }
}

export interface ChangedLineRange {
  start: number;
  count: number;
}

/**
 * Parse unified diff hunk headers to extract which line ranges changed in the new file.
 * Hunk format: @@ -old_start,old_count +new_start,new_count @@
 */
export function parseChangedLineRanges(diff: string): ChangedLineRange[] {
  const ranges: ChangedLineRange[] = [];
  const hunkPattern = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;
  let match;
  while ((match = hunkPattern.exec(diff)) !== null) {
    const start = parseInt(match[1], 10);
    const count = match[2] !== undefined ? parseInt(match[2], 10) : 1;
    if (count > 0) {
      ranges.push({ start, count });
    }
  }
  return ranges;
}
