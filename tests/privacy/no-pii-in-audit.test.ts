/**
 * Source-grep regression guard — ADR-0023 AC13.
 *
 * Reads the source of app/api/privacy/delete/route.ts and asserts that the
 * substrings 'email', 'full_name', and 'phone' do NOT appear inside the
 * before: { ... } / after: { ... } literal objects passed to withAudit.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROUTE_PATH = resolve(__dirname, '../../app/api/privacy/delete/route.ts');
const SOURCE = readFileSync(ROUTE_PATH, 'utf8');

// Helper: find all before:/after: { ... } literal objects and return contents.
function extractSnapshotContents(src: string, prefix: string): string[] {
  const results: string[] = [];
  let idx = src.indexOf(prefix + ": {");
  while (idx >= 0) {
    const start = idx + prefix.length + 3; // skip ": {"
    let depth = 1;
    let i = start;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++;
      if (src[i] === '}') depth--;
      i++;
    }
    results.push(src.slice(start, i - 1));
    idx = src.indexOf(prefix + ": {", idx + 1);
  }
  return results;
}

const PII_KEYS = ['email', 'full_name', 'phone'];

describe('no-pii-in-audit (AC13 source-grep guard)', () => {
  it('route source exists and is non-empty', () => {
    expect(SOURCE.length).toBeGreaterThan(0);
  });

  it('source contains before: snapshot literals', () => {
    const befores = extractSnapshotContents(SOURCE, 'before');
    expect(befores.length).toBeGreaterThan(0);
  });

  it('source contains after: snapshot literals', () => {
    const afters = extractSnapshotContents(SOURCE, 'after');
    expect(afters.length).toBeGreaterThan(0);
  });

  it('before: snapshots do NOT contain PII keys', () => {
    const befores = extractSnapshotContents(SOURCE, 'before');
    for (const content of befores) {
      for (const piiKey of PII_KEYS) {
        expect(content).not.toContain(piiKey);
      }
    }
  });

  it('after: snapshots do NOT contain PII keys', () => {
    const afters = extractSnapshotContents(SOURCE, 'after');
    for (const content of afters) {
      for (const piiKey of PII_KEYS) {
        expect(content).not.toContain(piiKey);
      }
    }
  });

  it('combined before+after regions near audit_log.insert do not contain PII', () => {
    // Anchor on the audit_log.insert call. Slice 1 path uses supabase-js
    // .from('audit_log').insert({ ... before, after ... }); Slice 2 will
    // route through withAudit once the pg driver lands. Test stays valid
    // across both anchors via the insert(/withAudit(/ alternation.
    const auditAnchorIdx = (() => {
      const insertIdx = SOURCE.indexOf("from('audit_log').insert(");
      if (insertIdx >= 0) return insertIdx;
      return SOURCE.indexOf('withAudit(');
    })();
    expect(auditAnchorIdx).toBeGreaterThanOrEqual(0);
    const snippet = SOURCE.slice(
      Math.max(0, auditAnchorIdx - 50),
      Math.min(SOURCE.length, auditAnchorIdx + 2000),
    );
    const beforeRegion = extractSnapshotContents(snippet, 'before');
    const afterRegion = extractSnapshotContents(snippet, 'after');
    const combined = beforeRegion.join('') + afterRegion.join('');
    for (const piiKey of PII_KEYS) {
      expect(combined).not.toContain(piiKey);
    }
  });
});
