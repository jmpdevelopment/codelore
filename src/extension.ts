import * as vscode from 'vscode';
import { YamlStore } from './storage/yamlStore';
import { AnnotationDecorator } from './providers/annotationDecorator';
import { ReviewMarkerDecorator } from './providers/reviewMarkerDecorator';
import { CriticalDecorator } from './providers/criticalDecorator';
import { ChangePlanProvider } from './views/changePlanProvider';
import { CriticalQueueProvider } from './views/criticalQueueProvider';
import { CoverageBar } from './views/coverageBar';
import { registerAnnotateCommands } from './commands/annotate';
import { registerReviewCommands } from './commands/markReviewed';
import { registerCriticalCommands } from './commands/markCritical';
import { registerExportCommands } from './commands/exportPR';
import { ANNOTATION_CATEGORIES, CATEGORY_META } from './models/annotation';

export function activate(context: vscode.ExtensionContext): void {
  const store = new YamlStore();
  context.subscriptions.push({ dispose: () => store.dispose() });

  // Decoration providers
  const annotationDecorator = new AnnotationDecorator(store);
  const reviewMarkerDecorator = new ReviewMarkerDecorator(store);
  const criticalDecorator = new CriticalDecorator(store);
  context.subscriptions.push(annotationDecorator, reviewMarkerDecorator, criticalDecorator);

  // Sidebar views
  const changePlanProvider = new ChangePlanProvider(store);
  const criticalQueueProvider = new CriticalQueueProvider(store);
  vscode.window.registerTreeDataProvider('codediary.changePlan', changePlanProvider);
  vscode.window.registerTreeDataProvider('codediary.criticalQueue', criticalQueueProvider);

  // Status bar
  const coverageBar = new CoverageBar(store);
  context.subscriptions.push(coverageBar);

  // Commands
  registerAnnotateCommands(context, store);
  registerReviewCommands(context, store);
  registerCriticalCommands(context, store);
  registerExportCommands(context, store);

  // Filter command
  context.subscriptions.push(
    vscode.commands.registerCommand('codediary.filterByCategory', async () => {
      const items = [
        { label: '$(close) Clear Filter', category: undefined as string | undefined },
        ...ANNOTATION_CATEGORIES.map(cat => ({
          label: `${CATEGORY_META[cat].icon} ${CATEGORY_META[cat].label}`,
          category: cat as string | undefined,
        })),
      ];
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Filter annotations by category',
      });
      if (picked !== undefined) {
        changePlanProvider.setFilter(picked.category as any);
      }
    }),

    vscode.commands.registerCommand('codediary.refreshSidebar', () => {
      changePlanProvider.refresh();
      criticalQueueProvider.refresh();
    }),

    vscode.commands.registerCommand('codediary.showChangePlan', () => {
      vscode.commands.executeCommand('codediary.changePlan.focus');
    }),
  );

  console.log('CodeDiary activated');
}

export function deactivate(): void {
  // Cleanup handled by disposables
}
