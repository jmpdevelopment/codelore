import * as vscode from 'vscode';
import { DiaryStore } from './storage/diaryStore';
import { AnnotationDecorator } from './providers/annotationDecorator';
import { ReviewMarkerDecorator } from './providers/reviewMarkerDecorator';
import { CriticalDecorator } from './providers/criticalDecorator';
import { ChangePlanProvider } from './views/changePlanProvider';
import { CriticalQueueProvider } from './views/criticalQueueProvider';
import { CoverageBar } from './views/coverageBar';
import { registerAnnotateCommands } from './commands/annotate';
import { registerReviewCommands } from './commands/markReviewed';
import { registerCriticalCommands } from './commands/markCritical';
import { registerExportCommands } from './commands/clearAll';
import { registerSearchCommands } from './commands/search';
import { registerQuickNoteCommands } from './commands/quickNote';
import { registerAgentInstructionCommands } from './commands/agentInstructions';
import { registerReanchorCommands } from './commands/reanchor';
import { ANNOTATION_CATEGORIES, CATEGORY_META, AnnotationCategory } from './models/annotation';
import { CriticalSeverity } from './models/criticalFlag';
import { LmService } from './ai/lmService';
import { DiaryGenerator } from './ai/diaryGenerator';
import { CriticalDetector } from './ai/criticalDetector';

export function activate(context: vscode.ExtensionContext): void {
  const store = new DiaryStore();
  const lm = new LmService();
  const diaryGenerator = new DiaryGenerator(lm, store);
  const criticalDetector = new CriticalDetector(lm, store);
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
  registerSearchCommands(context, store);
  registerQuickNoteCommands(context, store);
  registerAgentInstructionCommands(context, store);
  registerReanchorCommands(context, store);

  // Filter command
  context.subscriptions.push(
    vscode.commands.registerCommand('codediary.filterByCategory', async () => {
      const items: Array<{ label: string; category: AnnotationCategory | undefined }> = [
        { label: '$(close) Clear Filter', category: undefined },
        ...ANNOTATION_CATEGORIES.map(cat => ({
          label: `${CATEGORY_META[cat].icon} ${CATEGORY_META[cat].label}`,
          category: cat as AnnotationCategory | undefined,
        })),
      ];
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Filter annotations by category',
      });
      if (picked !== undefined) {
        changePlanProvider.setFilter(picked.category);
      }
    }),

    vscode.commands.registerCommand('codediary.filterByPath', async () => {
      const current = changePlanProvider.getActiveFilters().path;
      const input = await vscode.window.showInputBox({
        prompt: 'Filter by file/folder path (leave empty to clear)',
        placeHolder: 'e.g. src/auth or middleware.ts',
        value: current || '',
      });
      if (input === undefined) { return; }
      const pathFilter = input.trim() || undefined;
      changePlanProvider.setPathFilter(pathFilter);
      criticalQueueProvider.setPathFilter(pathFilter);
    }),

    vscode.commands.registerCommand('codediary.filterBySeverity', async () => {
      const items: Array<{ label: string; severity: CriticalSeverity | undefined }> = [
        { label: '$(close) Clear Filter', severity: undefined },
        { label: '$(error) Critical', severity: 'critical' },
        { label: '$(warning) High', severity: 'high' },
        { label: '$(info) Medium', severity: 'medium' },
      ];
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Filter critical flags by severity',
      });
      if (picked !== undefined) {
        criticalQueueProvider.setSeverityFilter(picked.severity);
      }
    }),

    vscode.commands.registerCommand('codediary.clearFilters', () => {
      changePlanProvider.setFilter(undefined);
      changePlanProvider.setPathFilter(undefined);
      criticalQueueProvider.setPathFilter(undefined);
      criticalQueueProvider.setSeverityFilter(undefined);
      vscode.window.showInformationMessage('CodeDiary: All filters cleared');
    }),

    vscode.commands.registerCommand('codediary.refreshSidebar', () => {
      changePlanProvider.refresh();
      criticalQueueProvider.refresh();
    }),

    vscode.commands.registerCommand('codediary.showChangePlan', () => {
      vscode.commands.executeCommand('codediary.changePlan.focus');
    }),

    // AI commands
    vscode.commands.registerCommand('codediary.suggestDiary', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('CodeDiary: Open a file first.');
        return;
      }
      await diaryGenerator.suggestForFile(editor);
    }),

    vscode.commands.registerCommand('codediary.suggestDiaryAll', async () => {
      await diaryGenerator.suggestForAllChanges();
    }),

    vscode.commands.registerCommand('codediary.scanCritical', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('CodeDiary: Open a file first.');
        return;
      }
      await criticalDetector.scanCurrentFile(editor);
    }),

    vscode.commands.registerCommand('codediary.scanCriticalAll', async () => {
      await criticalDetector.scanAllChanges();
    }),

    vscode.commands.registerCommand('codediary.changeModel', async () => {
      await lm.changeModel();
    }),

    vscode.commands.registerCommand('codediary.scanFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('CodeDiary: Open a file first.');
        return;
      }
      await criticalDetector.scanFileContent(editor);
    }),
  );

  console.log('CodeDiary activated');
}

export function deactivate(): void {
  // Cleanup handled by disposables
}
