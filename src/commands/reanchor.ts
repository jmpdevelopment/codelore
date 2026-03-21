import * as vscode from 'vscode';
import { DiaryStore } from '../storage/diaryStore';
import { getRelativePath } from '../utils/git';
import { checkAnchors, computeContentHash, AnchorCheckResult } from '../utils/anchorEngine';
import { CATEGORY_META } from '../models/annotation';

interface ReanchorPickItem extends vscode.QuickPickItem {
  result: AnchorCheckResult;
  itemType: 'annotation' | 'critical_flag';
  originalIndex?: number;
}

export function registerReanchorCommands(context: vscode.ExtensionContext, store: DiaryStore): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('codediary.reanchor', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }

      const filePath = getRelativePath(editor.document.uri);
      if (!filePath) { return; }

      const fileLines = editor.document.getText().split('\n');
      const annotations = store.getAnnotationsForFile(filePath);
      const criticalFlags = store.getCriticalFlagsForFile(filePath);

      // Check annotations
      const annItems = annotations.map(a => ({
        id: a.id,
        line_start: a.line_start,
        line_end: a.line_end,
        anchor: a.anchor,
      }));
      const annResults = checkAnchors(fileLines, annItems);

      // Check critical flags (use a synthetic id for flags)
      const flagItems = criticalFlags.map((f, i) => ({
        id: `flag-${i}`,
        line_start: f.line_start,
        line_end: f.line_end,
        anchor: f.anchor,
      }));
      const flagResults = checkAnchors(fileLines, flagItems);

      const staleAnnotations = annResults.filter(r => r.stale);
      const staleFlags = flagResults.filter(r => r.stale);

      if (staleAnnotations.length === 0 && staleFlags.length === 0) {
        vscode.window.showInformationMessage('CodeDiary: All anchors are up to date for this file.');
        return;
      }

      // Build quick pick items for stale annotations
      const items: ReanchorPickItem[] = [];

      for (const result of staleAnnotations) {
        const ann = annotations.find(a => a.id === result.id);
        if (!ann) { continue; }
        const meta = CATEGORY_META[ann.category];

        if (result.candidate) {
          items.push({
            label: `${meta.icon} ${ann.text.substring(0, 50)}`,
            description: `L${result.currentLineStart}-${result.currentLineEnd} → L${result.candidate.line_start}-${result.candidate.line_end}`,
            detail: `${meta.label} — content found at new location (${result.candidate.confidence} confidence)`,
            picked: true,
            result,
            itemType: 'annotation',
          });
        } else {
          items.push({
            label: `${meta.icon} ${ann.text.substring(0, 50)}`,
            description: `L${result.currentLineStart}-${result.currentLineEnd} — content not found`,
            detail: `${meta.label} — original content may have been deleted or heavily edited`,
            picked: false,
            result,
            itemType: 'annotation',
          });
        }
      }

      for (const result of staleFlags) {
        const idx = parseInt(result.id.replace('flag-', ''), 10);
        const flag = criticalFlags[idx];
        if (!flag) { continue; }

        if (result.candidate) {
          items.push({
            label: `$(shield) ${flag.description || 'Critical region'}`,
            description: `L${result.currentLineStart}-${result.currentLineEnd} → L${result.candidate.line_start}-${result.candidate.line_end}`,
            detail: `${flag.severity} — content found at new location (${result.candidate.confidence} confidence)`,
            picked: true,
            result,
            itemType: 'critical_flag',
            originalIndex: idx,
          });
        } else {
          items.push({
            label: `$(shield) ${flag.description || 'Critical region'}`,
            description: `L${result.currentLineStart}-${result.currentLineEnd} — content not found`,
            detail: `${flag.severity} — original content may have been deleted or heavily edited`,
            picked: false,
            result,
            itemType: 'critical_flag',
            originalIndex: idx,
          });
        }
      }

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `${items.length} stale anchor(s) found. Select which to re-anchor:`,
        canPickMany: true,
      }) as ReanchorPickItem[] | undefined;

      if (!picked || picked.length === 0) { return; }

      let reanchored = 0;
      let dismissed = 0;

      for (const item of picked) {
        if (item.itemType === 'annotation' && item.result.candidate) {
          const newHash = computeContentHash(fileLines, item.result.candidate.line_start, item.result.candidate.line_end);
          store.updateAnnotation(item.result.id, {
            line_start: item.result.candidate.line_start,
            line_end: item.result.candidate.line_end,
            anchor: { content_hash: newHash, stale: false },
          });
          reanchored++;
        } else if (item.itemType === 'critical_flag' && item.result.candidate && item.originalIndex !== undefined) {
          const flag = criticalFlags[item.originalIndex];
          const newHash = computeContentHash(fileLines, item.result.candidate.line_start, item.result.candidate.line_end);
          store.updateCriticalFlag(filePath, flag.line_start, {
            line_start: item.result.candidate.line_start,
            line_end: item.result.candidate.line_end,
            anchor: { content_hash: newHash, stale: false },
          });
          reanchored++;
        } else if (!item.result.candidate) {
          // User selected a "not found" item — mark as acknowledged stale
          if (item.itemType === 'annotation') {
            store.updateAnnotation(item.result.id, {
              anchor: { content_hash: '', stale: true },
            });
          }
          dismissed++;
        }
      }

      const parts: string[] = [];
      if (reanchored > 0) { parts.push(`${reanchored} re-anchored`); }
      if (dismissed > 0) { parts.push(`${dismissed} marked stale`); }
      vscode.window.showInformationMessage(`CodeDiary: ${parts.join(', ')}.`);
    }),

    vscode.commands.registerCommand('codediary.verifyAnchors', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }

      const filePath = getRelativePath(editor.document.uri);
      if (!filePath) { return; }

      const fileLines = editor.document.getText().split('\n');
      const annotations = store.getAnnotationsForFile(filePath);
      const criticalFlags = store.getCriticalFlagsForFile(filePath);

      const annItems = annotations.map(a => ({
        id: a.id,
        line_start: a.line_start,
        line_end: a.line_end,
        anchor: a.anchor,
      }));
      const flagItems = criticalFlags.map((f, i) => ({
        id: `flag-${i}`,
        line_start: f.line_start,
        line_end: f.line_end,
        anchor: f.anchor,
      }));

      const annResults = checkAnchors(fileLines, annItems);
      const flagResults = checkAnchors(fileLines, flagItems);

      const staleCount = [...annResults, ...flagResults].filter(r => r.stale).length;
      const totalAnchored = [...annResults, ...flagResults].length;
      const withoutAnchors = (annotations.length + criticalFlags.length) - totalAnchored;

      if (staleCount === 0 && withoutAnchors === 0) {
        vscode.window.showInformationMessage('CodeDiary: All anchors verified — no drift detected.');
      } else if (staleCount === 0) {
        vscode.window.showInformationMessage(`CodeDiary: ${totalAnchored} anchored items verified. ${withoutAnchors} legacy item(s) without anchors.`);
      } else {
        const action = await vscode.window.showWarningMessage(
          `CodeDiary: ${staleCount} stale anchor(s) detected in this file.`,
          'Re-anchor now',
        );
        if (action === 'Re-anchor now') {
          vscode.commands.executeCommand('codediary.reanchor');
        }
      }
    }),
  );
}
