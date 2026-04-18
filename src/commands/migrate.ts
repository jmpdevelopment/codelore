import * as vscode from 'vscode';
import { migrateWorkspace } from '../storage/migration';

/**
 * Registers `codediary.migrateToV2`. Runs the v1 → v2 in-place migration
 * against the active workspace (shared YAML under `.codediary/`, personal
 * YAML under the configured storage path).
 */
export function registerMigrateCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('codediary.migrateToV2', async () => {
      const workspace = vscode.workspace.workspaceFolders?.[0];
      if (!workspace) {
        vscode.window.showWarningMessage('CodeDiary: Open a workspace first.');
        return;
      }

      const personalRelative = vscode.workspace
        .getConfiguration('codediary')
        .get<string>('storagePath', '.vscode/codediary.yaml');

      try {
        const report = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'CodeDiary: Migrating to v2 schema…' },
          async () => migrateWorkspace(workspace.uri.fsPath, personalRelative),
        );

        if (report.filesWritten === 0) {
          vscode.window.showInformationMessage(
            `CodeDiary: Already on v2 — scanned ${report.filesScanned} file(s), nothing to migrate.`,
          );
        } else {
          vscode.window.showInformationMessage(
            `CodeDiary: Migrated ${report.filesWritten}/${report.filesScanned} file(s) — ${report.annotationsRemapped} annotation(s) remapped, ${report.sourcesNormalized} source value(s) normalized.`,
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`CodeDiary: Migration failed — ${message}`);
      }
    }),
  );
}
