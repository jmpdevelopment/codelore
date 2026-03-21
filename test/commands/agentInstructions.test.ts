import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codediary-agent-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Test the core logic of updateFileContent and buildBlock independently
const CODEDIARY_BLOCK_START = '# CodeDiary Integration';
const CODEDIARY_BLOCK_END = '# End CodeDiary Integration';

const INSTRUCTION_TEXT = `When modifying files in this project, check for CodeDiary annotations before making changes:

1. Look for \`.codediary/\` directory at the project root — it contains per-file YAML annotations committed by the team.
2. For a file like \`src/auth/middleware.ts\`, check \`.codediary/src/auth/middleware.ts.yaml\` for existing annotations.
3. Each annotation has: line range, category (verified, needs_review, modified, confused, hallucination, intent, accepted), and text.
4. Critical flags mark security-sensitive or high-risk regions — respect these and do not modify flagged code without explicit instruction.
5. If you add or change code in an annotated region, mention the existing annotation context in your response.
6. After making changes, suggest the developer add CodeDiary annotations for the modified regions.`;

function buildBlock(): string {
  return `${CODEDIARY_BLOCK_START}\n\n${INSTRUCTION_TEXT}\n\n${CODEDIARY_BLOCK_END}`;
}

function updateFileContent(existing: string, block: string): string {
  const startIdx = existing.indexOf(CODEDIARY_BLOCK_START);
  const endIdx = existing.indexOf(CODEDIARY_BLOCK_END);

  if (startIdx !== -1 && endIdx !== -1) {
    return existing.substring(0, startIdx) + block + existing.substring(endIdx + CODEDIARY_BLOCK_END.length);
  }

  const trimmed = existing.trimEnd();
  return trimmed ? trimmed + '\n\n' + block + '\n' : block + '\n';
}

describe('Agent instruction generation', () => {
  it('buildBlock creates valid instruction block', () => {
    const block = buildBlock();
    expect(block).toContain(CODEDIARY_BLOCK_START);
    expect(block).toContain(CODEDIARY_BLOCK_END);
    expect(block).toContain('.codediary/');
    expect(block).toContain('Critical flags');
  });

  it('updateFileContent appends to empty file', () => {
    const block = buildBlock();
    const result = updateFileContent('', block);
    expect(result).toBe(block + '\n');
  });

  it('updateFileContent appends to existing content', () => {
    const block = buildBlock();
    const existing = '# My Project\n\nSome existing content.';
    const result = updateFileContent(existing, block);
    expect(result).toContain('# My Project');
    expect(result).toContain('Some existing content.');
    expect(result).toContain(CODEDIARY_BLOCK_START);
    expect(result.indexOf('Some existing content.')).toBeLessThan(result.indexOf(CODEDIARY_BLOCK_START));
  });

  it('updateFileContent replaces existing block', () => {
    const block = buildBlock();
    const oldBlock = `${CODEDIARY_BLOCK_START}\n\nOld instructions.\n\n${CODEDIARY_BLOCK_END}`;
    const existing = `# My Project\n\n${oldBlock}\n\n# Other Section`;
    const result = updateFileContent(existing, block);
    expect(result).not.toContain('Old instructions.');
    expect(result).toContain(INSTRUCTION_TEXT);
    expect(result).toContain('# Other Section');
    // Should only have one start marker
    expect(result.split(CODEDIARY_BLOCK_START).length).toBe(2);
  });

  it('writes instruction file to disk', () => {
    const block = buildBlock();
    const filePath = path.join(tmpDir, 'CLAUDE.md');
    fs.writeFileSync(filePath, block + '\n', 'utf8');

    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain(CODEDIARY_BLOCK_START);
    expect(content).toContain('.codediary/');
  });

  it('creates nested directories for .github/copilot-instructions.md', () => {
    const block = buildBlock();
    const dir = path.join(tmpDir, '.github');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'copilot-instructions.md');
    fs.writeFileSync(filePath, block + '\n', 'utf8');

    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf8')).toContain(CODEDIARY_BLOCK_START);
  });

  it('updates existing file preserving surrounding content', () => {
    const block = buildBlock();
    const filePath = path.join(tmpDir, '.cursorrules');
    fs.writeFileSync(filePath, '# Cursor Rules\n\nUse TypeScript.\n', 'utf8');

    const existing = fs.readFileSync(filePath, 'utf8');
    const updated = updateFileContent(existing, block);
    fs.writeFileSync(filePath, updated, 'utf8');

    const final = fs.readFileSync(filePath, 'utf8');
    expect(final).toContain('# Cursor Rules');
    expect(final).toContain('Use TypeScript.');
    expect(final).toContain(CODEDIARY_BLOCK_START);
  });

  it('idempotent update replaces block cleanly', () => {
    const block = buildBlock();
    const filePath = path.join(tmpDir, 'AGENTS.md');

    // First write
    fs.writeFileSync(filePath, '# Agents\n', 'utf8');
    let content = fs.readFileSync(filePath, 'utf8');
    content = updateFileContent(content, block);
    fs.writeFileSync(filePath, content, 'utf8');

    // Second write (update)
    content = fs.readFileSync(filePath, 'utf8');
    content = updateFileContent(content, block);
    fs.writeFileSync(filePath, content, 'utf8');

    const final = fs.readFileSync(filePath, 'utf8');
    // Only one block
    expect(final.split(CODEDIARY_BLOCK_START).length).toBe(2);
    expect(final.split(CODEDIARY_BLOCK_END).length).toBe(2);
  });
});
