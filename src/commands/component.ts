import * as vscode from 'vscode';
import * as path from 'path';
import { DiaryStore } from '../storage/diaryStore';
import { Component, isValidComponentId, slugify } from '../models/component';
import { getGitUser, getRelativePath } from '../utils/git';
import { isSafeRelativePath } from '../utils/validation';

/**
 * Human-facing component commands: tag/untag (primary grouping entry),
 * edit (fill in description / owners after tagging), and jump
 * (open one of a component's files). Components are tag-first: the
 * tagging commands create bare entries, and `editComponent` is the
 * follow-up that turns them into real definitions.
 *
 * All pickers accept an optional pre-selected component so the same
 * handler can drive both the command palette and the sidebar context
 * menu (where the TreeItem is passed as the argument).
 */

const CREATE_NEW_ID = '__create_new__';

function pickedComponent(arg: unknown): Component | undefined {
  if (!arg || typeof arg !== 'object') { return undefined; }
  const c = (arg as { component?: Component }).component;
  return c && typeof c.id === 'string' ? c : undefined;
}

async function promptForComponent(store: DiaryStore, placeholder: string): Promise<Component | undefined> {
  const all = store.getComponents();
  if (all.length === 0) {
    vscode.window.showInformationMessage(
      'CodeDiary: No components yet. Tag a file to create one.',
    );
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    all.map(c => ({
      label: `$(symbol-namespace) ${c.name}`,
      description: c.id,
      detail: c.description,
      id: c.id,
    })),
    { placeHolder: placeholder },
  );
  return picked ? store.getComponent(picked.id) : undefined;
}

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

    vscode.commands.registerCommand('codediary.editComponent', async (arg?: unknown) => {
      const component = pickedComponent(arg)
        ?? (await promptForComponent(store, 'Which component should be edited?'));
      if (!component) { return; }

      const name = await vscode.window.showInputBox({
        prompt: 'Component name',
        value: component.name,
        validateInput: v => v.trim() ? undefined : 'Name cannot be empty',
      });
      if (name === undefined) { return; }

      const description = await vscode.window.showInputBox({
        prompt: 'Description (leave empty to clear)',
        value: component.description ?? '',
        placeHolder: 'What does this component do?',
      });
      if (description === undefined) { return; }

      const owners = await vscode.window.showInputBox({
        prompt: 'Owners (comma-separated, leave empty to clear)',
        value: (component.owners ?? []).join(', '),
        placeHolder: 'alice, bob',
      });
      if (owners === undefined) { return; }

      const ownerList = owners.split(',').map(o => o.trim()).filter(Boolean);

      store.components.upsert({
        ...component,
        name: name.trim(),
        description: description.trim() || undefined,
        owners: ownerList.length > 0 ? ownerList : undefined,
      });
      vscode.window.showInformationMessage(`CodeDiary: Updated "${name.trim()}".`);
    }),

    vscode.commands.registerCommand('codediary.jumpToComponent', async (arg?: unknown) => {
      const component = pickedComponent(arg)
        ?? (await promptForComponent(store, 'Which component should we jump into?'));
      if (!component) { return; }

      if (component.files.length === 0) {
        vscode.window.showInformationMessage(
          `CodeDiary: "${component.name}" has no files tagged yet.`,
        );
        return;
      }

      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) { return; }

      let target: string | undefined;
      if (component.files.length === 1) {
        target = component.files[0];
      } else {
        const picked = await vscode.window.showQuickPick(
          component.files.map(f => ({ label: f })),
          { placeHolder: `Files in "${component.name}"` },
        );
        target = picked?.label;
      }
      if (!target || !isSafeRelativePath(target)) { return; }

      const uri = vscode.Uri.file(path.join(wsFolder.uri.fsPath, target));
      await vscode.commands.executeCommand('vscode.open', uri);
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
