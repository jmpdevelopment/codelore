import * as vscode from 'vscode';
import { LoreStore } from './storage/loreStore';
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
import { registerFilterCommand } from './commands/filter';
import { LmService } from './ai/lmService';
import { LoreGenerator } from './ai/loreGenerator';
import { ComponentProposer } from './ai/componentProposer';

export function activate(context: vscode.ExtensionContext): void {
  const store = new LoreStore();
  const lm = new LmService();
  const loreGenerator = new LoreGenerator(lm, store);
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
  vscode.window.registerTreeDataProvider('codelore.changePlan', changePlanProvider);
  vscode.window.registerTreeDataProvider('codelore.criticalQueue', criticalQueueProvider);
  vscode.window.registerTreeDataProvider('codelore.preCommitBrief', preCommitBriefProvider);
  vscode.window.registerTreeDataProvider('codelore.components', componentsProvider);
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
  registerFilterCommand(context, store, changePlanProvider, criticalQueueProvider);

  context.subscriptions.push(
    vscode.commands.registerCommand('codelore.refreshSidebar', () => {
      changePlanProvider.refresh();
      criticalQueueProvider.refresh();
      preCommitBriefProvider.refresh();
      componentsProvider.refresh();
    }),

    vscode.commands.registerCommand('codelore.showChangePlan', () => {
      vscode.commands.executeCommand('codelore.changePlan.focus');
    }),

    vscode.commands.registerCommand('codelore.showPreCommitBrief', () => {
      vscode.commands.executeCommand('codelore.preCommitBrief.focus');
    }),

    vscode.commands.registerCommand('codelore.proposeComponent', async () => {
      await componentProposer.propose();
    }),

    vscode.commands.registerCommand('codelore.changeModel', async () => {
      await lm.changeModel();
    }),

    // Scan commands: file (interactive), component (batch), project (batch).
    // Each scan is a single model call per file that produces both knowledge
    // annotations and critical flags together.
    vscode.commands.registerCommand('codelore.scanFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('CodeLore: Open a file first.');
        return;
      }
      await loreGenerator.scanFile(editor);
    }),

    vscode.commands.registerCommand('codelore.scanComponent', async () => {
      const components = store.getComponents();
      if (components.length === 0) {
        vscode.window.showInformationMessage(
          'CodeLore: No components defined yet. Tag a file to create one, or use "Propose Components".',
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
          `CodeLore: Component "${component.name}" has no files yet.`,
        );
        return;
      }
      await loreGenerator.scanFiles(component.files, `component ${component.name}`);
    }),

    vscode.commands.registerCommand('codelore.scanProject', async () => {
      const files = await vscode.workspace.findFiles(
        '**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,rs,java,kt,swift,rb,php,cs,cpp,cc,c,h,hpp,sh}',
        '**/{node_modules,.git,dist,build,out,coverage,.next,.turbo,vendor}/**',
      );
      if (files.length === 0) {
        vscode.window.showInformationMessage('CodeLore: No source files found in the workspace.');
        return;
      }

      // First-run bootstrap: without components, AI entries land untagged and
      // the resulting lore is a flat pile. Offer to propose components first
      // so annotations slot into the right subsystems from the start.
      if (store.getComponents().length === 0) {
        const choice = await vscode.window.showInformationMessage(
          'CodeLore: No components defined yet. Propose components first so new annotations can be tagged into subsystems?',
          { modal: true },
          'Propose Components First',
          'Scan Without Components',
        );
        if (choice === undefined) { return; }
        if (choice === 'Propose Components First') {
          await componentProposer.propose();
        }
      }

      const confirm = await vscode.window.showWarningMessage(
        `CodeLore will scan ${files.length} files with the language model. This makes ${files.length} LLM calls and may incur cost. Continue?`,
        { modal: true },
        'Scan All Files',
      );
      if (confirm !== 'Scan All Files') { return; }
      const relativePaths = files
        .map(uri => vscode.workspace.asRelativePath(uri, false))
        .sort();
      await loreGenerator.scanFiles(relativePaths, `project (${relativePaths.length} files)`);
    }),
  );

  console.log('CodeLore activated');
}

export function deactivate(): void {
  // Cleanup handled by disposables
}
