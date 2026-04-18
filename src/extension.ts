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

    vscode.commands.registerCommand('codediary.showPreCommitBrief', () => {
      vscode.commands.executeCommand('codediary.preCommitBrief.focus');
    }),

    vscode.commands.registerCommand('codediary.proposeComponent', async () => {
      await componentProposer.propose();
    }),

    vscode.commands.registerCommand('codediary.changeModel', async () => {
      await lm.changeModel();
    }),

    // Scan commands: file (interactive), component (batch), project (batch)
    vscode.commands.registerCommand('codediary.scanFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('CodeDiary: Open a file first.');
        return;
      }
      await diaryGenerator.scanForKnowledge(editor);
      await criticalDetector.scanFileContent(editor);
    }),

    vscode.commands.registerCommand('codediary.scanComponent', async () => {
      const components = store.getComponents();
      if (components.length === 0) {
        vscode.window.showInformationMessage(
          'CodeDiary: No components defined yet. Tag a file to create one, or use "Propose Components".',
        );
        return;
      }
      let chosenId: string | undefined;
      if (components.length === 1) {
        chosenId = components[0].id;
      } else {
        const picked = await vscode.window.showQuickPick(
          components.map(c => ({
            label: `$(symbol-namespace) ${c.name}`,
            description: `${c.id} · ${c.files.length} file${c.files.length === 1 ? '' : 's'}`,
            id: c.id,
          })),
          { placeHolder: 'Pick a component to scan' },
        );
        chosenId = picked?.id;
      }
      if (!chosenId) { return; }
      const component = components.find(c => c.id === chosenId)!;
      if (component.files.length === 0) {
        vscode.window.showInformationMessage(
          `CodeDiary: Component "${component.name}" has no files yet.`,
        );
        return;
      }
      await diaryGenerator.scanFiles(component.files, `component ${component.name}`);
      await criticalDetector.scanFiles(component.files, `component ${component.name}`);
    }),

    vscode.commands.registerCommand('codediary.scanProject', async () => {
      const files = await vscode.workspace.findFiles(
        '**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,rs,java,kt,swift,rb,php,cs,cpp,cc,c,h,hpp,sh}',
        '**/{node_modules,.git,dist,build,out,coverage,.next,.turbo,vendor}/**',
      );
      if (files.length === 0) {
        vscode.window.showInformationMessage('CodeDiary: No source files found in the workspace.');
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `CodeDiary will scan ${files.length} files with the language model. This makes ${files.length * 2} LLM calls (knowledge + critical) and may incur cost. Continue?`,
        { modal: true },
        'Scan All Files',
      );
      if (confirm !== 'Scan All Files') { return; }
      const relativePaths = files
        .map(uri => vscode.workspace.asRelativePath(uri, false))
        .sort();
      await diaryGenerator.scanFiles(relativePaths, `project (${relativePaths.length} files)`);
      await criticalDetector.scanFiles(relativePaths, `project (${relativePaths.length} files)`);
    }),
  );

  console.log('CodeDiary activated');
}

export function deactivate(): void {
  // Cleanup handled by disposables
}
