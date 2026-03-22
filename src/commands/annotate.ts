import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { DiaryStore, Scope } from '../storage/diaryStore';
import { Annotation, ANNOTATION_CATEGORIES, CATEGORY_META, AnnotationCategory, FileDependency } from '../models/annotation';
import { getGitUser, getRelativePath } from '../utils/git';
import { computeContentHash, computeSignatureHash } from '../utils/anchorEngine';

async function pickScope(store: DiaryStore): Promise<Scope | undefined> {
  const defaultScope = store.getDefaultScope();
  const items = [
    {
      label: '$(globe) Team knowledge (persists)',
      description: defaultScope === 'shared' ? '(default)' : '',
      detail: 'Saved to .codediary/ — committed to git, visible to team',
      scope: 'shared' as Scope,
    },
    {
      label: '$(note) Personal notes (private)',
      description: defaultScope === 'personal' ? '(default)' : '',
      detail: 'Saved to .vscode/ — gitignored, just for you',
      scope: 'personal' as Scope,
    },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Will this outlive your current work session?',
  });
  return picked?.scope;
}

async function promptDependencies(): Promise<FileDependency[]> {
  const deps: FileDependency[] = [];

  // Ask if user wants to add a dependency link
  const addDep = await vscode.window.showQuickPick(
    [
      { label: '$(link) Add cross-file dependency', id: 'yes' as const },
      { label: '$(dash) Skip', id: 'no' as const },
    ],
    { placeHolder: 'Link this annotation to another file? (e.g., "must stay in sync with billing/calc.py")' },
  );

  if (!addDep || addDep.id === 'no') { return deps; }

  // Loop to allow adding multiple dependencies
  while (true) {
    const filePath = await vscode.window.showInputBox({
      prompt: 'Dependent file path (relative to workspace root)',
      placeHolder: 'e.g., src/billing/calculator.py',
    });
    if (!filePath) { break; }

    const relationship = await vscode.window.showInputBox({
      prompt: 'How are these files related?',
      placeHolder: 'e.g., must stay in sync, calls this function, shares this data model',
    });
    if (relationship === undefined) { break; }

    deps.push({
      file: filePath,
      relationship: relationship || 'related',
    });

    const more = await vscode.window.showQuickPick(
      [
        { label: '$(add) Add another dependency', id: 'yes' as const },
        { label: '$(check) Done', id: 'no' as const },
      ],
      { placeHolder: `${deps.length} dependency link${deps.length !== 1 ? 's' : ''} added` },
    );

    if (!more || more.id === 'no') { break; }
  }

  return deps;
}

export function registerAnnotateCommands(context: vscode.ExtensionContext, store: DiaryStore): void {
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

      // Check for overlapping annotations
      const overlapping = store.findOverlapping(filePath, lineStart, lineEnd);
      if (overlapping.length > 0) {
        const overlapItems = [
          { label: '$(add) Keep both', id: 'keep' as const },
          { label: '$(replace) Replace existing', id: 'replace' as const },
          { label: '$(close) Cancel', id: 'cancel' as const },
        ];
        const choice = await vscode.window.showQuickPick(overlapItems, {
          placeHolder: `${overlapping.length} existing annotation(s) overlap this range. What do you want to do?`,
        });
        if (!choice || choice.id === 'cancel') { return; }
        if (choice.id === 'replace') {
          for (const a of overlapping) {
            store.deleteAnnotation(a.id);
          }
        }
      }

      // Pick scope
      const scope = await pickScope(store);
      if (!scope) { return; }

      // Compute content anchor from current file content
      const fileLines = editor.document.getText().split('\n');
      const contentHash = computeContentHash(fileLines, lineStart, lineEnd);
      const signatureHash = computeSignatureHash(fileLines, lineStart, lineEnd);

      // Offer cross-file dependency linking
      const dependencies = await promptDependencies();

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
        anchor: { content_hash: contentHash, signature_hash: signatureHash, stale: false },
        dependencies: dependencies.length > 0 ? dependencies : undefined,
      };

      store.addAnnotation(annotation, scope);
      const scopeLabel = scope === 'shared' ? 'team' : 'working notes';
      const depMsg = dependencies.length > 0 ? ` with ${dependencies.length} dependency link${dependencies.length !== 1 ? 's' : ''}` : '';
      vscode.window.showInformationMessage(
        `CodeDiary: ${CATEGORY_META[picked.category].label} annotation added (${scopeLabel})${depMsg}`,
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
