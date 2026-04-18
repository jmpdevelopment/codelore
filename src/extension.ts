import * as vscode from 'vscode';
import { DiaryStore } from './storage/diaryStore';
import { AnnotationDecorator } from './providers/annotationDecorator';
import { CriticalDecorator } from './providers/criticalDecorator';
import { KnowledgeNotifier } from './providers/knowledgeNotifier';
import { ChangePlanProvider } from './views/changePlanProvider';
import { CriticalQueueProvider } from './views/criticalQueueProvider';
import { PreCommitBriefProvider } from './views/preCommitBriefProvider';
import { ComponentsProvider } from './views/componentsProvider';
import { CoverageBar } from './views/coverageBar';
import { ComponentBar } from './views/componentBar';
import { registerAnnotateCommands } from './commands/annotate';
import { registerCriticalCommands } from './commands/markCritical';
import { registerExportCommands } from './commands/clearAll';
import { registerSearchCommands } from './commands/search';
import { registerQuickNoteCommands } from './commands/quickNote';
import { registerAgentInstructionCommands } from './commands/agentInstructions';
import { registerReanchorCommands } from './commands/reanchor';
import { registerMigrateCommand } from './commands/migrate';
import { registerComponentCommands } from './commands/component';
import { ANNOTATION_CATEGORIES, CATEGORY_META, AnnotationCategory } from './models/annotation';
import { CriticalSeverity } from './models/criticalFlag';
import { LmService } from './ai/lmService';
import { DiaryGenerator } from './ai/diaryGenerator';
import { CriticalDetector } from './ai/criticalDetector';
import { ComponentProposer } from './ai/componentProposer';

export function activate(context: vscode.ExtensionContext): void {
  const store = new DiaryStore();
  const lm = new LmService();
  const diaryGenerator = new DiaryGenerator(lm, store);
  const criticalDetector = new CriticalDetector(lm, store);
  const componentProposer = new ComponentProposer(lm, store);
  context.subscriptions.push({ dispose: () => store.dispose() });

  // Decoration providers
  const annotationDecorator = new AnnotationDecorator(store);
  const criticalDecorator = new CriticalDecorator(store);
  const knowledgeNotifier = new KnowledgeNotifier(store);
  context.subscriptions.push(annotationDecorator, criticalDecorator, knowledgeNotifier);

  // Sidebar views
  const changePlanProvider = new ChangePlanProvider(store);
  const criticalQueueProvider = new CriticalQueueProvider(store);
  const preCommitBriefProvider = new PreCommitBriefProvider(store);
  const componentsProvider = new ComponentsProvider(store);
  vscode.window.registerTreeDataProvider('codediary.changePlan', changePlanProvider);
  vscode.window.registerTreeDataProvider('codediary.criticalQueue', criticalQueueProvider);
  vscode.window.registerTreeDataProvider('codediary.preCommitBrief', preCommitBriefProvider);
  vscode.window.registerTreeDataProvider('codediary.components', componentsProvider);
  context.subscriptions.push(preCommitBriefProvider);

  // Status bar
  const coverageBar = new CoverageBar(store);
  const componentBar = new ComponentBar(store);
  context.subscriptions.push(coverageBar, componentBar);

  // Commands
  registerAnnotateCommands(context, store);
  registerCriticalCommands(context, store);
  registerExportCommands(context, store);
  registerSearchCommands(context, store);
  registerQuickNoteCommands(context, store);
  registerAgentInstructionCommands(context, store);
  registerReanchorCommands(context, store);
  registerMigrateCommand(context);
  registerComponentCommands(context, store);

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

    vscode.commands.registerCommand('codediary.filterByComponent', async () => {
      const components = store.getComponents();
      if (components.length === 0) {
        vscode.window.showInformationMessage(
          'CodeDiary: No components defined yet. Tag a file to create one.',
        );
        return;
      }
      const items: Array<{ label: string; description?: string; id: string | undefined }> = [
        { label: '$(close) Clear Filter', id: undefined },
        ...components.map(c => ({
          label: `$(symbol-namespace) ${c.name}`,
          description: `${c.id} · ${c.files.length} file${c.files.length === 1 ? '' : 's'}`,
          id: c.id as string | undefined,
        })),
      ];
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Filter annotations by component',
      });
      if (picked !== undefined) {
        changePlanProvider.setComponentFilter(picked.id);
      }
    }),

    vscode.commands.registerCommand('codediary.clearFilters', () => {
      changePlanProvider.setFilter(undefined);
      changePlanProvider.setPathFilter(undefined);
      changePlanProvider.setComponentFilter(undefined);
      criticalQueueProvider.setPathFilter(undefined);
      criticalQueueProvider.setSeverityFilter(undefined);
      vscode.window.showInformationMessage('CodeDiary: All filters cleared');
    }),

    vscode.commands.registerCommand('codediary.refreshSidebar', () => {
      changePlanProvider.refresh();
      criticalQueueProvider.refresh();
      preCommitBriefProvider.refresh();
      componentsProvider.refresh();
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

    vscode.commands.registerCommand('codediary.scanForKnowledge', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('CodeDiary: Open a file first.');
        return;
      }
      await diaryGenerator.scanForKnowledge(editor);
    }),

    vscode.commands.registerCommand('codediary.proposeComponent', async () => {
      await componentProposer.propose();
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
