import { describe, it, expect } from 'vitest';
import {
  computeContentHash,
  computeSignatureHash,
  extractSignature,
  findBySignature,
  verifyAnchor,
  findReanchorCandidate,
  checkAnchors,
} from '../../src/utils/anchorEngine';

const sampleFile = [
  'import { foo } from "bar";',        // 1
  '',                                    // 2
  'function hello() {',                  // 3
  '  console.log("hello");',            // 4
  '  return true;',                      // 5
  '}',                                   // 6
  '',                                    // 7
  'function goodbye() {',               // 8
  '  console.log("goodbye");',          // 9
  '  return false;',                     // 10
  '}',                                   // 11
];

describe('computeContentHash', () => {
  it('returns a 16-char hex string', () => {
    const hash = computeContentHash(sampleFile, 3, 6);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('same content produces same hash', () => {
    const h1 = computeContentHash(sampleFile, 3, 6);
    const h2 = computeContentHash(sampleFile, 3, 6);
    expect(h1).toBe(h2);
  });

  it('different content produces different hash', () => {
    const h1 = computeContentHash(sampleFile, 3, 6);
    const h2 = computeContentHash(sampleFile, 8, 11);
    expect(h1).not.toBe(h2);
  });

  it('ignores leading/trailing whitespace on lines', () => {
    const withSpaces = [
      '  function hello() {  ',
      '    console.log("hello");  ',
      '    return true;  ',
      '  }  ',
    ];
    const withoutSpaces = [
      'function hello() {',
      'console.log("hello");',
      'return true;',
      '}',
    ];
    const h1 = computeContentHash(withSpaces, 1, 4);
    const h2 = computeContentHash(withoutSpaces, 1, 4);
    expect(h1).toBe(h2);
  });

  it('ignores empty lines', () => {
    const withBlanks = [
      'function hello() {',
      '',
      '  console.log("hello");',
      '',
      '  return true;',
      '}',
    ];
    const withoutBlanks = [
      'function hello() {',
      '  console.log("hello");',
      '  return true;',
      '}',
    ];
    const h1 = computeContentHash(withBlanks, 1, 6);
    const h2 = computeContentHash(withoutBlanks, 1, 4);
    expect(h1).toBe(h2);
  });
});

describe('verifyAnchor', () => {
  it('returns true for matching content', () => {
    const hash = computeContentHash(sampleFile, 3, 6);
    expect(verifyAnchor(sampleFile, 3, 6, hash)).toBe(true);
  });

  it('returns false when content has changed', () => {
    const hash = computeContentHash(sampleFile, 3, 6);
    const modifiedFile = [...sampleFile];
    modifiedFile[3] = '  console.log("world");';
    expect(verifyAnchor(modifiedFile, 3, 6, hash)).toBe(false);
  });

  it('returns false for out-of-range lines', () => {
    const hash = computeContentHash(sampleFile, 3, 6);
    expect(verifyAnchor(sampleFile, 3, 20, hash)).toBe(false);
  });

  it('returns false for line_start < 1', () => {
    const hash = computeContentHash(sampleFile, 3, 6);
    expect(verifyAnchor(sampleFile, 0, 6, hash)).toBe(false);
  });
});

describe('findReanchorCandidate', () => {
  it('finds content that shifted down', () => {
    const hash = computeContentHash(sampleFile, 3, 6);
    // Insert 3 blank lines at the top
    const shifted = ['', '', '', ...sampleFile];
    const result = findReanchorCandidate(shifted, 3, 6, hash);
    expect(result).toBeDefined();
    expect(result!.line_start).toBe(6);
    expect(result!.line_end).toBe(9);
    expect(result!.confidence).toBe('high');
  });

  it('finds content that shifted up', () => {
    const hash = computeContentHash(sampleFile, 8, 11);
    // Remove lines 1-2 (import + blank)
    const shifted = sampleFile.slice(2);
    const result = findReanchorCandidate(shifted, 8, 11, hash);
    expect(result).toBeDefined();
    expect(result!.line_start).toBe(6);
    expect(result!.line_end).toBe(9);
  });

  it('returns exact confidence when content has not moved', () => {
    const hash = computeContentHash(sampleFile, 3, 6);
    const result = findReanchorCandidate(sampleFile, 3, 6, hash);
    expect(result).toBeDefined();
    expect(result!.confidence).toBe('exact');
    expect(result!.line_start).toBe(3);
  });

  it('returns undefined when content is deleted', () => {
    const hash = computeContentHash(sampleFile, 3, 6);
    const withoutHello = [
      'import { foo } from "bar";',
      '',
      'function goodbye() {',
      '  console.log("goodbye");',
      '  return false;',
      '}',
    ];
    const result = findReanchorCandidate(withoutHello, 3, 6, hash);
    expect(result).toBeUndefined();
  });

  it('returns undefined when file is too short', () => {
    const hash = computeContentHash(sampleFile, 3, 6);
    const result = findReanchorCandidate(['one', 'two'], 3, 6, hash);
    expect(result).toBeUndefined();
  });

  it('picks closest match when content appears multiple times', () => {
    const repeated = [
      'function hello() {',        // 1
      '  console.log("hello");',   // 2
      '  return true;',            // 3
      '}',                          // 4
      '',                            // 5
      'function hello() {',        // 6
      '  console.log("hello");',   // 7
      '  return true;',            // 8
      '}',                          // 9
    ];
    const hash = computeContentHash(repeated, 1, 4);
    // Original was at line 1-4, should prefer that location
    const result = findReanchorCandidate(repeated, 1, 4, hash);
    expect(result).toBeDefined();
    expect(result!.line_start).toBe(1);
    expect(result!.confidence).toBe('exact');

    // If original was at line 6-9, should prefer that
    const result2 = findReanchorCandidate(repeated, 6, 9, hash);
    expect(result2).toBeDefined();
    expect(result2!.line_start).toBe(6);
    expect(result2!.confidence).toBe('exact');
  });
});

describe('checkAnchors', () => {
  it('skips items without anchors', () => {
    const results = checkAnchors(sampleFile, [
      { id: 'a1', line_start: 3, line_end: 6 },
    ]);
    expect(results).toHaveLength(0);
  });

  it('reports non-stale for matching content', () => {
    const hash = computeContentHash(sampleFile, 3, 6);
    const results = checkAnchors(sampleFile, [
      { id: 'a1', line_start: 3, line_end: 6, anchor: { content_hash: hash, stale: false } },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].stale).toBe(false);
    expect(results[0].candidate).toBeUndefined();
  });

  it('reports stale with candidate when content shifted', () => {
    const hash = computeContentHash(sampleFile, 3, 6);
    const shifted = ['', '', '', ...sampleFile];
    const results = checkAnchors(shifted, [
      { id: 'a1', line_start: 3, line_end: 6, anchor: { content_hash: hash, stale: false } },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].stale).toBe(true);
    expect(results[0].candidate).toBeDefined();
    expect(results[0].candidate!.line_start).toBe(6);
  });

  it('reports stale without candidate when content deleted', () => {
    const hash = computeContentHash(sampleFile, 3, 6);
    const withoutHello = [
      'import { foo } from "bar";',
      '',
      'function goodbye() {',
      '  console.log("goodbye");',
      '  return false;',
      '}',
    ];
    const results = checkAnchors(withoutHello, [
      { id: 'a1', line_start: 3, line_end: 6, anchor: { content_hash: hash, stale: false } },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].stale).toBe(true);
    expect(results[0].candidate).toBeUndefined();
  });

  it('handles multiple items with mixed staleness', () => {
    const hashHello = computeContentHash(sampleFile, 3, 6);
    const hashGoodbye = computeContentHash(sampleFile, 8, 11);

    // File where hello moved but goodbye stayed
    const modified = [
      'import { foo } from "bar";',
      '',
      '// new code here',
      'function hello() {',
      '  console.log("hello");',
      '  return true;',
      '}',
      '',
      'function goodbye() {',
      '  console.log("goodbye");',
      '  return false;',
      '}',
    ];

    const results = checkAnchors(modified, [
      { id: 'a1', line_start: 3, line_end: 6, anchor: { content_hash: hashHello, stale: false } },
      { id: 'a2', line_start: 8, line_end: 11, anchor: { content_hash: hashGoodbye, stale: false } },
    ]);

    expect(results).toHaveLength(2);
    // hello shifted from 3-6 to 4-7
    const helloResult = results.find(r => r.id === 'a1')!;
    expect(helloResult.stale).toBe(true);
    expect(helloResult.candidate).toBeDefined();
    expect(helloResult.candidate!.line_start).toBe(4);

    // goodbye shifted from 8-11 to 9-12
    const goodbyeResult = results.find(r => r.id === 'a2')!;
    expect(goodbyeResult.stale).toBe(true);
    expect(goodbyeResult.candidate).toBeDefined();
    expect(goodbyeResult.candidate!.line_start).toBe(9);
  });
});

// ── Signature anchoring ─────────────────────────────────────────────

const pythonFile = [
  'import os',                                // 1
  '',                                          // 2
  'class BillingService:',                    // 3
  '    def calculate_total(self, items):',    // 4
  '        total = sum(i.price for i in items)',  // 5
  '        return total * 1.1',               // 6
  '',                                          // 7
  '    def apply_discount(self, total, code):', // 8
  '        if code == "VIP":',                // 9
  '            return total * 0.9',           // 10
  '        return total',                     // 11
];

const tsFile = [
  'import { User } from "./models";',        // 1
  '',                                          // 2
  'export async function fetchUser(id: string): Promise<User> {', // 3
  '  const res = await fetch(`/api/users/${id}`);', // 4
  '  return res.json();',                     // 5
  '}',                                         // 6
  '',                                          // 7
  'export const processPayment = async (amount: number) => {', // 8
  '  await stripe.charge(amount);',           // 9
  '  return { success: true };',              // 10
  '};',                                        // 11
];

describe('extractSignature', () => {
  it('finds Python function signatures', () => {
    const sig = extractSignature(pythonFile, 4, 6);
    expect(sig).toBe('def calculate_total(self, items):');
  });

  it('finds Python class signatures', () => {
    const sig = extractSignature(pythonFile, 3, 6);
    expect(sig).toBe('class BillingService:');
  });

  it('finds TypeScript function signatures', () => {
    const sig = extractSignature(tsFile, 3, 6);
    expect(sig).toBe('export async function fetchUser(id: string): Promise<User> {');
  });

  it('finds arrow function signatures', () => {
    const sig = extractSignature(tsFile, 8, 11);
    expect(sig).toBe('export const processPayment = async (amount: number) => {');
  });

  it('returns undefined for non-signature code', () => {
    const plainCode = [
      '  const x = 42;',
      '  console.log(x);',
    ];
    const sig = extractSignature(plainCode, 1, 2);
    expect(sig).toBeUndefined();
  });
});

describe('computeSignatureHash', () => {
  it('returns a 16-char hex hash for regions with signatures', () => {
    const hash = computeSignatureHash(pythonFile, 4, 6);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('returns undefined for regions without signatures', () => {
    const plainCode = ['  const x = 42;', '  return x;'];
    const hash = computeSignatureHash(plainCode, 1, 2);
    expect(hash).toBeUndefined();
  });

  it('same signature produces same hash', () => {
    const h1 = computeSignatureHash(pythonFile, 4, 6);
    const h2 = computeSignatureHash(pythonFile, 4, 6);
    expect(h1).toBe(h2);
  });

  it('different signatures produce different hashes', () => {
    const h1 = computeSignatureHash(pythonFile, 4, 6);
    const h2 = computeSignatureHash(pythonFile, 8, 11);
    expect(h1).not.toBe(h2);
  });
});

describe('findBySignature', () => {
  it('finds a function by its signature hash', () => {
    const hash = computeSignatureHash(pythonFile, 4, 6)!;
    const line = findBySignature(pythonFile, 4, hash);
    expect(line).toBe(4);
  });

  it('finds a function that has moved', () => {
    const hash = computeSignatureHash(pythonFile, 4, 6)!;
    // Insert lines at top, pushing the function down
    const shifted = ['# new comment', '# another', ...pythonFile];
    const line = findBySignature(shifted, 4, hash);
    expect(line).toBe(6); // 4 + 2 lines inserted
  });

  it('returns undefined when signature is removed', () => {
    const hash = computeSignatureHash(pythonFile, 4, 6)!;
    const withoutCalc = [
      'import os',
      '',
      'class BillingService:',
      '    pass',
    ];
    const line = findBySignature(withoutCalc, 4, hash);
    expect(line).toBeUndefined();
  });
});

describe('findReanchorCandidate with signature fallback', () => {
  it('falls back to signature when content hash fails', () => {
    const contentHash = computeContentHash(pythonFile, 4, 6);
    const sigHash = computeSignatureHash(pythonFile, 4, 6)!;

    // Modify the function body but keep the signature
    const modified = [
      'import os',
      '',
      'class BillingService:',
      '    def calculate_total(self, items):',
      '        total = sum(i.price * i.qty for i in items)',  // body changed
      '        return total * 1.15',                           // body changed
    ];

    // Without signature, content hash won't match
    const withoutSig = findReanchorCandidate(modified, 4, 6, contentHash);
    expect(withoutSig).toBeUndefined();

    // With signature, it finds the function
    const withSig = findReanchorCandidate(modified, 4, 6, contentHash, sigHash);
    expect(withSig).toBeDefined();
    expect(withSig!.line_start).toBe(4);
    expect(withSig!.confidence).toBe('low');
  });

  it('prefers content hash over signature when both match', () => {
    const contentHash = computeContentHash(pythonFile, 4, 6);
    const sigHash = computeSignatureHash(pythonFile, 4, 6)!;

    // Unchanged file — content hash should match exactly
    const result = findReanchorCandidate(pythonFile, 4, 6, contentHash, sigHash);
    expect(result).toBeDefined();
    expect(result!.confidence).toBe('exact'); // content hash match, not signature fallback
  });

  it('finds moved function via signature when body also changed', () => {
    const contentHash = computeContentHash(pythonFile, 4, 6);
    const sigHash = computeSignatureHash(pythonFile, 4, 6)!;

    // Function moved down and body changed
    const modified = [
      'import os',
      '',
      '# new helper',
      'def helper():',
      '    pass',
      '',
      'class BillingService:',
      '    def calculate_total(self, items):',
      '        return sum(i.total for i in items)',  // different body
    ];

    const result = findReanchorCandidate(modified, 4, 6, contentHash, sigHash);
    expect(result).toBeDefined();
    expect(result!.line_start).toBe(8);
    expect(result!.confidence).toBe('low');
  });
});

describe('checkAnchors with signature_hash', () => {
  it('uses signature fallback when content changed but signature intact', () => {
    const contentHash = computeContentHash(pythonFile, 4, 6);
    const sigHash = computeSignatureHash(pythonFile, 4, 6)!;

    const modified = [
      'import os',
      '',
      'class BillingService:',
      '    def calculate_total(self, items):',
      '        # refactored implementation',
      '        return sum(i.subtotal for i in items) * 1.1',
    ];

    const results = checkAnchors(modified, [
      {
        id: 'a1',
        line_start: 4,
        line_end: 6,
        anchor: { content_hash: contentHash, signature_hash: sigHash, stale: false },
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].stale).toBe(true);
    expect(results[0].candidate).toBeDefined();
    expect(results[0].candidate!.line_start).toBe(4);
    expect(results[0].candidate!.confidence).toBe('low');
  });
});
