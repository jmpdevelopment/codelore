import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  CODEDIARY_BLOCK_START,
  CODEDIARY_BLOCK_END,
  INSTRUCTION_TEXT,
  buildBlock,
  updateFileContent,
} from '../../src/commands/agentInstructions';
import { KNOWLEDGE_CATEGORIES } from '../../src/models/annotation';

const LEGACY_CATEGORY_NAMES = [
  'verified', 'needs_review', 'modified', 'confused',
  'hallucination', 'intent', 'accepted',
] as const;

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codediary-agent-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Agent instruction text', () => {
  it('lists every knowledge category', () => {
    for (const cat of KNOWLEDGE_CATEGORIES) {
      expect(INSTRUCTION_TEXT).toContain(`\`${cat}\``);
    }
  });

  it('does not advertise legacy categories', () => {
    for (const cat of LEGACY_CATEGORY_NAMES) {
      expect(INSTRUCTION_TEXT).not.toMatch(new RegExp(`\`${cat}\``));
    }
  });

  it('tells agents to author annotations, not just read them', () => {
    expect(INSTRUCTION_TEXT).toMatch(/author/i);
    expect(INSTRUCTION_TEXT).toContain('source: ai_generated');
  });

  it('documents components and their storage path', () => {
    expect(INSTRUCTION_TEXT).toContain('.codediary/components/');
  });

  it('explains v2 anchoring (content_hash + signature_hash)', () => {
    expect(INSTRUCTION_TEXT).toContain('content_hash');
    expect(INSTRUCTION_TEXT).toContain('signature_hash');
  });

  it('warns about unverified ai_generated annotations', () => {
    expect(INSTRUCTION_TEXT).toContain('ai_generated');
    expect(INSTRUCTION_TEXT).toMatch(/ai_verified|verified|human-verified/);
  });
});

describe('Agent instruction block assembly', () => {
  it('buildBlock wraps the text in start/end markers', () => {
    const block = buildBlock();
    expect(block.startsWith(CODEDIARY_BLOCK_START)).toBe(true);
    expect(block.endsWith(CODEDIARY_BLOCK_END)).toBe(true);
    expect(block).toContain(INSTRUCTION_TEXT);
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

    fs.writeFileSync(filePath, '# Agents\n', 'utf8');
    let content = fs.readFileSync(filePath, 'utf8');
    content = updateFileContent(content, block);
    fs.writeFileSync(filePath, content, 'utf8');

    content = fs.readFileSync(filePath, 'utf8');
    content = updateFileContent(content, block);
    fs.writeFileSync(filePath, content, 'utf8');

    const final = fs.readFileSync(filePath, 'utf8');
    expect(final.split(CODEDIARY_BLOCK_START).length).toBe(2);
    expect(final.split(CODEDIARY_BLOCK_END).length).toBe(2);
  });
});
