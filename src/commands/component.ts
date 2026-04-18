import * as vscode from 'vscode';
import { LoreStore } from '../storage/loreStore';
import { Component, isValidComponentId, slugify } from '../models/component';
import { getGitUser, getRelativePath } from '../utils/git';

/**
 * Human-facing component commands: manage memberships (tag/untag in
 * one multi-select) and edit (fill in description / owners after
 * tagging). Components are tag-first: the management command creates
 * bare entries, and `editComponent` turns them into real definitions.
 *
 * Pickers accept an optional pre-selected component so the same
 * handler can drive both the command palette and the sidebar context
 * menu (where the TreeItem is passed as the argument).
 */

const CREATE_NEW_ID = '__create_new__';

function pickedComponent(arg: unknown): Component | undefined {
  if (!arg || typeof arg !== 'object') { return undefined; }
  const c = (arg as { component?: Component }).component;
  return c && typeof c.id === 'string' ? c : undefined;
}

async function promptForComponent(store: LoreStore, placeholder: string): Promise<Component | undefined> {
  const all = store.getComponents();
  if (all.length === 0) {
    vscode.window.showInformationMessage(
      'CodeLore: No components yet. Tag a file to create one.',
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

async function createNewComponent(store: LoreStore): Promise<Component | undefined> {
  const name = await vscode.window.showInputBox({
    prompt: 'Component name',
    placeHolder: 'e.g., Billing Engine',
  });
  if (!name) { return undefined; }
  const id = slugify(name);
  if (!isValidComponentId(id)) {
    vscode.window.showErrorMessage(`CodeLore: Could not derive a valid id from "${name}".`);
    return undefined;
  }
  if (store.getComponent(id)) {
    vscode.window.showWarningMessage(`CodeLore: Component "${id}" already exists. Pick it from the list.`);
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

async function pickOrCreateComponent(store: LoreStore): Promise<Component | undefined> {
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
    return createNewComponent(store);
  }

  return store.getComponent(picked.id);
}

export function registerComponentCommands(
  context: vscode.ExtensionContext,
  store: LoreStore,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('codelore.manageComponentsForFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('CodeLore: Open a file first.');
        return;
      }
      const filePath = getRelativePath(editor.document.uri);
      if (!filePath) {
        vscode.window.showInformationMessage('CodeLore: File must live inside the workspace.');
        return;
      }

      const all = store.getComponents();
      if (all.length === 0) {
        // First-time path: skip the empty multi-select and go straight to create.
        const created = await pickOrCreateComponent(store);
        if (!created) { return; }
        store.components.addFile(created.id, filePath);
        vscode.window.showInformationMessage(
          `CodeLore: Tagged ${filePath} into "${created.name}".`,
        );
        return;
      }

      const currentIds = new Set(store.getComponentsForFile(filePath).map(c => c.id));
      const items: Array<vscode.QuickPickItem & { id: string }> = [
        { label: '$(add) Create new component…', id: CREATE_NEW_ID },
        ...all.map(c => ({
          label: `$(symbol-namespace) ${c.name}`,
          description: c.id,
          detail: c.description,
          picked: currentIds.has(c.id),
          id: c.id,
        })),
      ];

      const picked = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: `Manage component memberships for ${filePath} (toggle to add/remove)`,
      }) as Array<vscode.QuickPickItem & { id: string }> | undefined;
      if (!picked) { return; }

      const wantsNew = picked.some(p => p.id === CREATE_NEW_ID);
      const pickedIds = new Set(picked.map(p => p.id).filter(id => id !== CREATE_NEW_ID));

      const added: string[] = [];
      const removed: string[] = [];
      for (const id of pickedIds) {
        if (!currentIds.has(id)) {
          store.components.addFile(id, filePath);
          added.push(store.getComponent(id)?.name ?? id);
        }
      }
      for (const id of currentIds) {
        if (!pickedIds.has(id)) {
          store.components.removeFile(id, filePath);
          removed.push(store.getComponent(id)?.name ?? id);
        }
      }

      if (wantsNew) {
        const created = await createNewComponent(store);
        if (created) {
          store.components.addFile(created.id, filePath);
          added.push(created.name);
        }
      }

      const parts: string[] = [];
      if (added.length > 0) { parts.push(`tagged into ${added.join(', ')}`); }
      if (removed.length > 0) { parts.push(`untagged from ${removed.join(', ')}`); }
      if (parts.length === 0) { return; }
      vscode.window.showInformationMessage(`CodeLore: ${filePath} ${parts.join('; ')}.`);
    }),

    vscode.commands.registerCommand('codelore.editComponent', async (arg?: unknown) => {
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
      vscode.window.showInformationMessage(`CodeLore: Updated "${name.trim()}".`);
    }),
  );
}
