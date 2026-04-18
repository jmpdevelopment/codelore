import * as vscode from 'vscode';
import { LoreStore } from '../storage/loreStore';
import { ChangePlanProvider } from '../views/changePlanProvider';
import { CriticalQueueProvider } from '../views/criticalQueueProvider';
import { ANNOTATION_CATEGORIES, CATEGORY_META, AnnotationCategory } from '../models/annotation';
import { CriticalSeverity } from '../models/criticalFlag';

type FilterAction = 'category' | 'component' | 'severity' | 'path' | 'clear';

export function registerFilterCommand(
  context: vscode.ExtensionContext,
  store: LoreStore,
  changePlan: ChangePlanProvider,
  criticalQueue: CriticalQueueProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('codelore.filter', async () => {
      const annFilters = changePlan.getActiveFilters();
      const critFilters = criticalQueue.getActiveFilters();

      const componentName = annFilters.component
        ? store.getComponent(annFilters.component)?.name ?? annFilters.component
        : undefined;

      const items: Array<vscode.QuickPickItem & { action?: FilterAction }> = [
        {
          label: '$(filter) Category',
          description: annFilters.category ? CATEGORY_META[annFilters.category].label : 'all',
          detail: 'Annotations sidebar',
          action: 'category',
        },
        {
          label: '$(symbol-namespace) Component',
          description: componentName ?? 'all',
          detail: 'Annotations sidebar',
          action: 'component',
        },
        {
          label: '$(shield) Severity',
          description: critFilters.severity ?? 'all',
          detail: 'Critical Review Queue',
          action: 'severity',
        },
        {
          label: '$(folder) Path',
          description: annFilters.path ?? critFilters.path ?? 'all',
          detail: 'Both sidebars',
          action: 'path',
        },
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(close) Clear all filters', action: 'clear' },
      ];

      const choice = await vscode.window.showQuickPick(items, {
        placeHolder: 'Filter — pick a dimension',
      });
      if (!choice?.action) { return; }

      switch (choice.action) {
        case 'category': await pickCategory(changePlan); break;
        case 'component': await pickComponent(store, changePlan); break;
        case 'severity': await pickSeverity(criticalQueue); break;
        case 'path': await pickPath(changePlan, criticalQueue, annFilters.path ?? critFilters.path); break;
        case 'clear': clearAll(changePlan, criticalQueue); break;
      }
    }),
  );
}

async function pickCategory(changePlan: ChangePlanProvider): Promise<void> {
  const items: Array<{ label: string; category: AnnotationCategory | undefined }> = [
    { label: '$(close) Clear category filter', category: undefined },
    ...ANNOTATION_CATEGORIES.map(cat => ({
      label: `${CATEGORY_META[cat].icon} ${CATEGORY_META[cat].label}`,
      category: cat as AnnotationCategory | undefined,
    })),
  ];
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Filter annotations by category',
  });
  if (picked) { changePlan.setFilter(picked.category); }
}

async function pickComponent(store: LoreStore, changePlan: ChangePlanProvider): Promise<void> {
  const components = store.getComponents();
  if (components.length === 0) {
    vscode.window.showInformationMessage(
      'CodeLore: No components defined yet. Tag a file to create one.',
    );
    return;
  }
  const items: Array<{ label: string; description?: string; id: string | undefined }> = [
    { label: '$(close) Clear component filter', id: undefined },
    ...components.map(c => ({
      label: `$(symbol-namespace) ${c.name}`,
      description: `${c.id} · ${c.files.length} file${c.files.length === 1 ? '' : 's'}`,
      id: c.id as string | undefined,
    })),
  ];
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Filter annotations by component',
  });
  if (picked) { changePlan.setComponentFilter(picked.id); }
}

async function pickSeverity(criticalQueue: CriticalQueueProvider): Promise<void> {
  const items: Array<{ label: string; severity: CriticalSeverity | undefined }> = [
    { label: '$(close) Clear severity filter', severity: undefined },
    { label: '$(error) Critical', severity: 'critical' },
    { label: '$(warning) High', severity: 'high' },
    { label: '$(info) Medium', severity: 'medium' },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Filter critical flags by severity',
  });
  if (picked) { criticalQueue.setSeverityFilter(picked.severity); }
}

async function pickPath(
  changePlan: ChangePlanProvider,
  criticalQueue: CriticalQueueProvider,
  current: string | undefined,
): Promise<void> {
  const input = await vscode.window.showInputBox({
    prompt: 'Filter by file/folder path (leave empty to clear)',
    placeHolder: 'e.g. src/auth or middleware.ts',
    value: current || '',
  });
  if (input === undefined) { return; }
  const pathFilter = input.trim() || undefined;
  changePlan.setPathFilter(pathFilter);
  criticalQueue.setPathFilter(pathFilter);
}

function clearAll(changePlan: ChangePlanProvider, criticalQueue: CriticalQueueProvider): void {
  changePlan.setFilter(undefined);
  changePlan.setPathFilter(undefined);
  changePlan.setComponentFilter(undefined);
  criticalQueue.setPathFilter(undefined);
  criticalQueue.setSeverityFilter(undefined);
  vscode.window.showInformationMessage('CodeLore: All filters cleared');
}
