import * as vscode from 'vscode';
import { DiaryStore } from '../storage/diaryStore';
import { Component, isValidComponentId, slugify } from '../models/component';
import { getGitUser, getRelativePath } from '../utils/git';

/**
 * File→component tagging commands. These are the primary human entry point
 * for grouping files into subsystems. Definitions (description, owners) can
 * be added later via `editComponent` (2.4).
 *
 * `tagFileComponent` supports both "use existing component" and
 * "create new component" in one flow so tagging rarely requires a second
 * action. Ids are derived from the display name via {@link slugify}.
 */

const CREATE_NEW_ID = '__create_new__';

async function pickOrCreateComponent(store: DiaryStore): Promise<Component | undefined> {
  const existing = store.getComponents();
  const items: Array<vscode.QuickPickItem & { id: string }> = existing.map(c => ({
    label: `$(symbol-namespace) ${c.name}`,
    description: c.id,
    detail: c.description,
    id: c.id,
  }));
  items.unshift({
    label: '$(add) Create new component…',
    id: CREATE_NEW_ID,
  });

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Pick a component to tag this file into',
  });
  if (!picked) { return undefined; }

  if (picked.id === CREATE_NEW_ID) {
    const name = await vscode.window.showInputBox({
      prompt: 'Component name',
      placeHolder: 'e.g., Billing Engine',
    });
    if (!name) { return undefined; }
    const id = slugify(name);
    if (!isValidComponentId(id)) {
      vscode.window.showErrorMessage(`CodeDiary: Could not derive a valid id from "${name}".`);
      return undefined;
    }
    if (store.getComponent(id)) {
      vscode.window.showWarningMessage(`CodeDiary: Component "${id}" already exists. Pick it from the list.`);
      return undefined;
    }
    const description = await vscode.window.showInputBox({
      prompt: '(Optional) short description',
      placeHolder: 'What does this component do?',
    });

    const now = new Date().toISOString();
    const created: Component = {
      id,
      name: name.trim(),
      description: description?.trim() || undefined,
      files: [],
      source: 'human_authored',
      created_at: now,
      updated_at: now,
      author: getGitUser(),
    };
    store.components.upsert(created);
    return store.getComponent(id);
  }

  return store.getComponent(picked.id);
}

export function registerComponentCommands(
  context: vscode.ExtensionContext,
  store: DiaryStore,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('codediary.tagFileComponent', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('CodeDiary: Open a file first.');
        return;
      }
      const filePath = getRelativePath(editor.document.uri);
      if (!filePath) {
        vscode.window.showInformationMessage('CodeDiary: File must live inside the workspace.');
        return;
      }

      const component = await pickOrCreateComponent(store);
      if (!component) { return; }

      if (component.files.includes(filePath)) {
        vscode.window.showInformationMessage(
          `CodeDiary: ${filePath} is already tagged into "${component.name}".`,
        );
        return;
      }

      store.components.addFile(component.id, filePath);
      vscode.window.showInformationMessage(
        `CodeDiary: Tagged ${filePath} into "${component.name}".`,
      );
    }),

    vscode.commands.registerCommand('codediary.untagFileComponent', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }
      const filePath = getRelativePath(editor.document.uri);
      if (!filePath) { return; }

      const current = store.getComponentsForFile(filePath);
      if (current.length === 0) {
        vscode.window.showInformationMessage(
          `CodeDiary: ${filePath} is not tagged into any component.`,
        );
        return;
      }

      const picked = await vscode.window.showQuickPick(
        current.map(c => ({
          label: `$(symbol-namespace) ${c.name}`,
          description: c.id,
          id: c.id,
        })),
        { placeHolder: 'Which component should this file be untagged from?' },
      );
      if (!picked) { return; }

      store.components.removeFile(picked.id, filePath);
      vscode.window.showInformationMessage(
        `CodeDiary: Untagged ${filePath} from "${picked.label.replace('$(symbol-namespace) ', '')}".`,
      );
    }),
  );
}
