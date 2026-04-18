import * as vscode from 'vscode';
import { LoreStore, Scope } from '../storage/loreStore';

/**
 * Shared scope picker for all commands that write to the store.
 * Consistent labels across annotations and critical flags.
 */
export async function pickScope(store: LoreStore): Promise<Scope | undefined> {
  const defaultScope = store.getDefaultScope();
  const items = [
    {
      label: '$(globe) Team knowledge (persists)',
      description: defaultScope === 'shared' ? '(default)' : '',
      detail: 'Saved to .codelore/ — committed to git, visible to team',
      scope: 'shared' as Scope,
    },
    {
      label: '$(lock) Personal notes (private)',
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
