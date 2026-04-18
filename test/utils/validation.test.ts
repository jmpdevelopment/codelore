import { describe, it, expect } from 'vitest';
import { isSafeRelativePath, sanitizeMarkdownText, stripJsonFences, truncateText, isValidCategory, isValidKnowledgeCategory } from '../../src/utils/validation';

describe('isSafeRelativePath', () => {
  it('accepts normal relative paths', () => {
    expect(isSafeRelativePath('src/foo.ts')).toBe(true);
    expect(isSafeRelativePath('src/auth/middleware.ts')).toBe(true);
    expect(isSafeRelativePath('file.yaml')).toBe(true);
  });

  it('rejects absolute paths', () => {
    expect(isSafeRelativePath('/etc/passwd')).toBe(false);
    expect(isSafeRelativePath('/Users/jmp/.ssh/id_rsa')).toBe(false);
  });

  it('rejects paths with .. traversal', () => {
    expect(isSafeRelativePath('../../../etc/passwd')).toBe(false);
    expect(isSafeRelativePath('src/../../etc/passwd')).toBe(false);
    expect(isSafeRelativePath('..')).toBe(false);
  });

  it('rejects empty or whitespace paths', () => {
    expect(isSafeRelativePath('')).toBe(false);
    expect(isSafeRelativePath('  ')).toBe(false);
  });

  it('accepts paths with dots in filenames', () => {
    expect(isSafeRelativePath('src/.codelore/foo.ts.yaml')).toBe(true);
    expect(isSafeRelativePath('.vscode/codelore.yaml')).toBe(true);
  });
});

describe('sanitizeMarkdownText', () => {
  it('passes through normal text', () => {
    expect(sanitizeMarkdownText('This is fine')).toBe('This is fine');
    expect(sanitizeMarkdownText('Token validation looks correct')).toBe('Token validation looks correct');
  });

  it('strips markdown links with command: URIs', () => {
    const malicious = 'Click [here](command:workbench.action.terminal.sendSequence?%7B%22text%22%3A%22rm%20-rf%22%7D)';
    const result = sanitizeMarkdownText(malicious);
    expect(result).not.toContain('command:');
    expect(result).toContain('here');
  });

  it('strips any markdown link syntax', () => {
    const withLink = 'See [this file](vscode://file/etc/passwd) for details';
    const result = sanitizeMarkdownText(withLink);
    expect(result).not.toContain('vscode://');
    expect(result).toContain('this file');
  });

  it('handles multiple links in one string', () => {
    const text = '[link1](command:evil) and [link2](http://example.com)';
    const result = sanitizeMarkdownText(text);
    expect(result).toBe('link1 and link2');
  });

  it('preserves text without links', () => {
    const text = '**Bold** and *italic* and `code`';
    expect(sanitizeMarkdownText(text)).toBe(text);
  });
});

describe('stripJsonFences', () => {
  it('strips ```json fences', () => {
    const raw = '```json\n[{"key": "value"}]\n```';
    expect(stripJsonFences(raw)).toBe('[{"key": "value"}]');
  });

  it('strips ``` fences without language', () => {
    const raw = '```\n[1, 2, 3]\n```';
    expect(stripJsonFences(raw)).toBe('[1, 2, 3]');
  });

  it('passes through plain JSON', () => {
    const raw = '[{"key": "value"}]';
    expect(stripJsonFences(raw)).toBe(raw);
  });

  it('trims whitespace', () => {
    expect(stripJsonFences('  [1]  ')).toBe('[1]');
  });

  it('handles empty string', () => {
    expect(stripJsonFences('')).toBe('');
  });
});

describe('truncateText', () => {
  it('returns text unchanged when under limit', () => {
    expect(truncateText('hello', 10)).toBe('hello');
  });

  it('returns text unchanged when at limit', () => {
    expect(truncateText('hello', 5)).toBe('hello');
  });

  it('truncates and adds ellipsis when over limit', () => {
    expect(truncateText('hello world', 5)).toBe('hello...');
  });

  it('handles empty string', () => {
    expect(truncateText('', 10)).toBe('');
  });
});

describe('isValidCategory', () => {
  it('accepts knowledge categories', () => {
    expect(isValidCategory('behavior')).toBe(true);
    expect(isValidCategory('business_rule')).toBe(true);
    expect(isValidCategory('security')).toBe(true);
  });

  it('accepts ai_prompt', () => {
    expect(isValidCategory('ai_prompt')).toBe(true);
  });

  it('rejects legacy v1 categories', () => {
    expect(isValidCategory('verified')).toBe(false);
    expect(isValidCategory('needs_review')).toBe(false);
    expect(isValidCategory('hallucination')).toBe(false);
  });

  it('rejects unknown values', () => {
    expect(isValidCategory('made-up')).toBe(false);
    expect(isValidCategory(42)).toBe(false);
    expect(isValidCategory(undefined)).toBe(false);
  });
});

describe('isValidKnowledgeCategory', () => {
  it('accepts all 8 knowledge categories', () => {
    for (const cat of ['behavior', 'rationale', 'constraint', 'gotcha', 'business_rule', 'performance', 'security', 'human_note']) {
      expect(isValidKnowledgeCategory(cat)).toBe(true);
    }
  });

  it('rejects legacy v1 categories', () => {
    for (const cat of ['verified', 'needs_review', 'modified', 'confused', 'hallucination', 'intent', 'accepted']) {
      expect(isValidKnowledgeCategory(cat)).toBe(false);
    }
  });

  it('rejects ai_prompt (ephemeral, not a knowledge category)', () => {
    expect(isValidKnowledgeCategory('ai_prompt')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isValidKnowledgeCategory(42)).toBe(false);
    expect(isValidKnowledgeCategory(undefined)).toBe(false);
  });
});
