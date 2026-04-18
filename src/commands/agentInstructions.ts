import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CATEGORY_META, KNOWLEDGE_CATEGORIES } from '../models/annotation';

export const CODEDIARY_BLOCK_START = '# CodeDiary Integration';
export const CODEDIARY_BLOCK_END = '# End CodeDiary Integration';

function categoryBullets(): string {
  return KNOWLEDGE_CATEGORIES
    .map(cat => `   - \`${cat}\` — ${CATEGORY_META[cat].description}`)
    .join('\n');
}

export const INSTRUCTION_TEXT = `CodeDiary is this project's institutional knowledge layer. Read it before modifying code, and write back to it when you learn something.

## Reading knowledge

1. \`.codediary/\` at the repo root holds per-file YAML annotations. For a file like \`src/auth/middleware.ts\`, read \`.codediary/src/auth/middleware.ts.yaml\` before changing it.
2. \`.codediary/components/*.yaml\` groups files into logical subsystems. Each component lists \`files\`, a \`description\`, and \`owners\`. When you touch a file in a component, you are acting on the whole component — honor its stated purpose.
3. Each annotation has \`file\`, \`line_start\`, \`line_end\`, \`category\`, \`source\`, and \`text\`. The 8 knowledge categories are:
${categoryBullets()}
4. \`dependencies\` on an annotation list cross-file links. When you modify a file that another annotation depends on, surface that upstream annotation in your response.
5. Critical flags in \`.codediary/<path>.yaml\` mark high-risk regions. Do not modify flagged code without explicit instruction.
6. Annotations whose \`source\` is \`ai_generated\` have not been human-verified — treat them as hypotheses, not ground truth. \`ai_verified\` and \`human_authored\` are trusted.

## Writing knowledge (you are expected to author)

CodeDiary expects AI agents to *author* annotations, not just consume them. After making non-trivial changes or discovering something non-obvious about the code, write annotations for what you learned.

7. Append new annotations to the relevant \`.codediary/<path>.yaml\` file (create it if missing). Required fields: \`id\` (uuid v4), \`file\`, \`line_start\`, \`line_end\`, \`category\` (one of the 8 above — never legacy), \`text\`, \`source: ai_generated\`, \`created_at\` (ISO 8601).
8. If files form a cohesive subsystem that isn't already a component, propose one at \`.codediary/components/<slug>.yaml\` with \`id\`, \`name\`, \`description\`, \`files\`, \`source: ai_generated\`, \`created_at\`, \`updated_at\`.
9. Do not fabricate. If you don't know, write nothing. Humans and other agents will read your annotations as the project's memory.

## Re-anchoring on refactor

10. When you move, rename, or refactor annotated code, update \`line_start\` and \`line_end\` in the corresponding \`.codediary/\` YAML. Also update \`anchor.content_hash\` (truncated SHA-256 of the trimmed non-empty lines joined by \`\\n\`) and \`anchor.signature_hash\` if present (hash of the function/class signature line). Silent drift causes false "stale" warnings and lost context.`;

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

export function buildBlock(): string {
  return `${CODEDIARY_BLOCK_START}\n\n${INSTRUCTION_TEXT}\n\n${CODEDIARY_BLOCK_END}`;
}

export function updateFileContent(existing: string, block: string): string {
  const startIdx = existing.indexOf(CODEDIARY_BLOCK_START);
  const endIdx = existing.indexOf(CODEDIARY_BLOCK_END);

  if (startIdx !== -1 && endIdx !== -1) {
    return existing.substring(0, startIdx) + block + existing.substring(endIdx + CODEDIARY_BLOCK_END.length);
  }

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
