import { describe, it, expect } from 'vitest';
import { isSafeRelativePath, sanitizeMarkdownText } from '../../src/utils/validation';

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
    expect(isSafeRelativePath('src/.codediary/foo.ts.yaml')).toBe(true);
    expect(isSafeRelativePath('.vscode/codediary.yaml')).toBe(true);
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
