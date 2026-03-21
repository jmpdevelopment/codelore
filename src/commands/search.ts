import * as vscode from 'vscode';
import * as path from 'path';
import { DiaryStore, SearchFilter, SearchResult } from '../storage/diaryStore';
import { ANNOTATION_CATEGORIES, CATEGORY_META, AnnotationCategory } from '../models/annotation';
import { isSafeRelativePath } from '../utils/validation';

async function pickSearchFilter(store: DiaryStore): Promise<SearchFilter | undefined> {
  const filterItems = [
    { label: '$(search) Search all annotations', id: 'all' },
    { label: '$(filter) Filter by category', id: 'category' },
    { label: '$(file) Filter by file/folder path', id: 'file' },
    { label: '$(shield) Show all critical flags', id: 'critical' },
  ];

  const mode = await vscode.window.showQuickPick(filterItems, {
    placeHolder: 'How do you want to search?',
  });
  if (!mode) { return undefined; }

  const filter: SearchFilter = {};

  if (mode.id === 'category') {
    const catItems = ANNOTATION_CATEGORIES.map(cat => ({
      label: `${CATEGORY_META[cat].icon} ${CATEGORY_META[cat].label}`,
      category: cat,
    }));
    const picked = await vscode.window.showQuickPick(catItems, {
      placeHolder: 'Select category to search',
    });
    if (!picked) { return undefined; }
    filter.category = picked.category;
  }

  if (mode.id === 'critical') {
    // Return with no filter — search() includes critical flags when no category filter
    // But we want ONLY critical flags, so we'll handle this in the command
    return { text: '', file: '', category: undefined };
  }

  if (mode.id === 'file' || mode.id === 'all' || mode.id === 'category') {
    if (mode.id === 'file') {
      const filePath = await vscode.window.showInputBox({
        prompt: 'File or folder path to search (partial match)',
        placeHolder: 'e.g. src/auth or middleware.ts',
      });
      if (filePath === undefined) { return undefined; }
      filter.file = filePath;
    }

    const text = await vscode.window.showInputBox({
      prompt: 'Search text (leave empty to show all)',
      placeHolder: 'e.g. billing, off-by-one, session...',
    });
    if (text === undefined) { return undefined; }
    filter.text = text;
  }

  return filter;
}

function openResult(result: SearchResult): void {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) { return; }
  if (!isSafeRelativePath(result.file)) { return; }

  const absPath = path.join(workspaceFolder.uri.fsPath, result.file);
  const uri = vscode.Uri.file(absPath);
  const line = Math.max(0, result.line_start - 1);

  vscode.window.showTextDocument(uri, {
    selection: new vscode.Range(line, 0, Math.max(0, result.line_end - 1), 0),
    preview: true,
  });
}

export function registerSearchCommands(context: vscode.ExtensionContext, store: DiaryStore): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('codediary.searchAnnotations', async () => {
      const filter = await pickSearchFilter(store);
      if (!filter) { return; }

      const results = store.search(filter);

      if (results.length === 0) {
        vscode.window.showInformationMessage('CodeDiary: No results found.');
        return;
      }

      const items = results.map(r => ({
        label: r.label,
        description: r.detail,
        result: r,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `${results.length} result${results.length === 1 ? '' : 's'} — select to jump to source`,
        matchOnDescription: true,
      });

      if (picked) {
        openResult(picked.result);
      }
    }),
  );
}
