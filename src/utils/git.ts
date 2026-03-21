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
