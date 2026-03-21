import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const CODEDIARY_BLOCK_START = '# CodeDiary Integration';
const CODEDIARY_BLOCK_END = '# End CodeDiary Integration';

const INSTRUCTION_TEXT = `When modifying files in this project, check for CodeDiary annotations before making changes:

1. Look for \`.codediary/\` directory at the project root — it contains per-file YAML annotations committed by the team.
2. For a file like \`src/auth/middleware.ts\`, check \`.codediary/src/auth/middleware.ts.yaml\` for existing annotations.
3. Each annotation has: line range, category (verified, needs_review, modified, confused, hallucination, intent, accepted), and text.
4. Critical flags mark security-sensitive or high-risk regions — respect these and do not modify flagged code without explicit instruction.
5. If you add or change code in an annotated region, mention the existing annotation context in your response.
6. After making changes, suggest the developer add CodeDiary annotations for the modified regions.`;

interface AgentFile {
  label: string;
  relativePath: string;
  wrapInSection: boolean;
}

const AGENT_FILES: AgentFile[] = [
  { label: 'CLAUDE.md (Claude Code)', relativePath: 'CLAUDE.md', wrapInSection: true },
  { label: '.cursorrules (Cursor)', relativePath: '.cursorrules', wrapInSection: true },
  { label: '.github/copilot-instructions.md (GitHub Copilot)', relativePath: '.github/copilot-instructions.md', wrapInSection: true },
  { label: 'AGENTS.md (Codex / OpenAI)', relativePath: 'AGENTS.md', wrapInSection: true },
  { label: '.windsurfrules (Windsurf)', relativePath: '.windsurfrules', wrapInSection: true },
];

function buildBlock(): string {
  return `${CODEDIARY_BLOCK_START}\n\n${INSTRUCTION_TEXT}\n\n${CODEDIARY_BLOCK_END}`;
}

function updateFileContent(existing: string, block: string): string {
  const startIdx = existing.indexOf(CODEDIARY_BLOCK_START);
  const endIdx = existing.indexOf(CODEDIARY_BLOCK_END);

  if (startIdx !== -1 && endIdx !== -1) {
    // Replace existing block
    return existing.substring(0, startIdx) + block + existing.substring(endIdx + CODEDIARY_BLOCK_END.length);
  }

  // Append to end
  const trimmed = existing.trimEnd();
  return trimmed ? trimmed + '\n\n' + block + '\n' : block + '\n';
}

export function registerAgentInstructionCommands(context: vscode.ExtensionContext, _store: unknown): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('codediary.generateAgentInstructions', async () => {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        vscode.window.showErrorMessage('CodeDiary: No workspace folder open.');
        return;
      }

      const items = AGENT_FILES.map(f => {
        const fullPath = path.join(workspaceRoot, f.relativePath);
        const exists = fs.existsSync(fullPath);
        return {
          label: f.label,
          description: exists ? '(will update)' : '(will create)',
          picked: true,
          file: f,
        };
      });

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select agent instruction files to generate',
        canPickMany: true,
      });
      if (!picked || picked.length === 0) { return; }

      const block = buildBlock();
      let created = 0;
      let updated = 0;

      for (const item of picked) {
        const fullPath = path.join(workspaceRoot, item.file.relativePath);
        const dir = path.dirname(fullPath);

        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        if (fs.existsSync(fullPath)) {
          const existing = fs.readFileSync(fullPath, 'utf8');
          const newContent = updateFileContent(existing, block);
          fs.writeFileSync(fullPath, newContent, 'utf8');
          updated++;
        } else {
          fs.writeFileSync(fullPath, block + '\n', 'utf8');
          created++;
        }
      }

      const parts: string[] = [];
      if (created > 0) { parts.push(`${created} created`); }
      if (updated > 0) { parts.push(`${updated} updated`); }
      vscode.window.showInformationMessage(`CodeDiary: Agent instructions — ${parts.join(', ')}.`);
    }),
  );
}
