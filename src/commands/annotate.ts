import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { YamlStore } from '../storage/yamlStore';
import { Annotation, ANNOTATION_CATEGORIES, CATEGORY_META, AnnotationCategory } from '../models/annotation';

function getGitUser(): string {
  try {
    const cp = require('child_process');
    return cp.execSync('git config user.name', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function getRelativePath(uri: vscode.Uri): string | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) { return undefined; }
  return vscode.workspace.asRelativePath(uri, false);
}

export function registerAnnotateCommands(context: vscode.ExtensionContext, store: YamlStore): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('codediary.addAnnotation', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }

      const filePath = getRelativePath(editor.document.uri);
      if (!filePath) { return; }

      const selection = editor.selection;
      const lineStart = selection.start.line + 1;
      const lineEnd = selection.end.line + 1;

      // Pick category
      const items = ANNOTATION_CATEGORIES.map(cat => ({
        label: `${CATEGORY_META[cat].icon} ${CATEGORY_META[cat].label}`,
        description: CATEGORY_META[cat].description,
        category: cat,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select annotation category',
      });
      if (!picked) { return; }

      // Enter text
      const text = await vscode.window.showInputBox({
        prompt: `${CATEGORY_META[picked.category].label} annotation for lines ${lineStart}-${lineEnd}`,
        placeHolder: 'Your note about this code...',
      });
      if (text === undefined) { return; }

      const annotation: Annotation = {
        id: uuidv4(),
        file: filePath,
        line_start: lineStart,
        line_end: lineEnd,
        category: picked.category,
        text: text || CATEGORY_META[picked.category].description,
        source: 'manual',
        created_at: new Date().toISOString(),
        author: getGitUser(),
      };

      store.addAnnotation(annotation);
      vscode.window.showInformationMessage(
        `CodeDiary: ${CATEGORY_META[picked.category].label} annotation added`,
      );
    }),

    vscode.commands.registerCommand('codediary.editAnnotation', async (annotationId?: string) => {
      if (!annotationId) {
        // Find annotations at current cursor
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }
        const filePath = getRelativePath(editor.document.uri);
        if (!filePath) { return; }
        const line = editor.selection.active.line + 1;
        const annotations = store.getAnnotationsForFile(filePath)
          .filter(a => line >= a.line_start && line <= a.line_end);
        if (annotations.length === 0) {
          vscode.window.showInformationMessage('No annotation at cursor');
          return;
        }
        if (annotations.length === 1) {
          annotationId = annotations[0].id;
        } else {
          const pick = await vscode.window.showQuickPick(
            annotations.map(a => ({
              label: `${CATEGORY_META[a.category].label}: ${a.text.substring(0, 60)}`,
              id: a.id,
            })),
            { placeHolder: 'Select annotation to edit' },
          );
          if (!pick) { return; }
          annotationId = pick.id;
        }
      }

      const annotation = store.getAnnotations().find(a => a.id === annotationId);
      if (!annotation) { return; }

      const newText = await vscode.window.showInputBox({
        prompt: 'Edit annotation text',
        value: annotation.text,
      });
      if (newText === undefined) { return; }

      store.updateAnnotation(annotationId, { text: newText });
    }),

    vscode.commands.registerCommand('codediary.deleteAnnotation', async (annotationId?: string) => {
      if (!annotationId) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }
        const filePath = getRelativePath(editor.document.uri);
        if (!filePath) { return; }
        const line = editor.selection.active.line + 1;
        const annotations = store.getAnnotationsForFile(filePath)
          .filter(a => line >= a.line_start && line <= a.line_end);
        if (annotations.length === 0) {
          vscode.window.showInformationMessage('No annotation at cursor');
          return;
        }
        if (annotations.length === 1) {
          annotationId = annotations[0].id;
        } else {
          const pick = await vscode.window.showQuickPick(
            annotations.map(a => ({
              label: `${CATEGORY_META[a.category].label}: ${a.text.substring(0, 60)}`,
              id: a.id,
            })),
            { placeHolder: 'Select annotation to delete' },
          );
          if (!pick) { return; }
          annotationId = pick.id;
        }
      }

      store.deleteAnnotation(annotationId);
      vscode.window.showInformationMessage('CodeDiary: Annotation deleted');
    }),
  );
}
