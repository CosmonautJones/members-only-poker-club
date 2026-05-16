/**
 * Cross-cutting source-grep guard — every mutation-class admin server
 * action MUST call `revalidateTag('admin-dashboard-counts')` post-tx
 * (ADR-0035 AC35, premortem R5, WD.T22 / t21).
 *
 * Run locally:    pnpm test tests/admin/dashboard-cache-invalidation.test.ts
 * Prerequisites:  none — pure source-text scan via node:fs readFileSync.
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC35.
 *
 * Contract:
 *   - Walk every `app/(admin)/admin/**\/_actions/*.ts` source file.
 *   - Skip the read-only allowlist: searchMembers.ts, queryAuditLog.ts
 *     (these issue only SELECT statements; no dashboard count to bust).
 *   - For every remaining file containing `INSERT`, `UPDATE`, or
 *     `DELETE` SQL keywords (mutation-class actions), assert the file
 *     contains the LITERAL string `revalidateTag('admin-dashboard-counts')`.
 *   - The barrel `index.ts` re-export modules are skipped (they contain
 *     only `export {} from ...` statements).
 *
 * Why source-grep: the dashboard's 30-second TTL plus the tag-based
 * invalidation is the operational guarantee that staff sees counts
 * refresh within seconds of a mutation. A future refactor that adds
 * a new mutation action but forgets the tag-bust would degrade the
 * dashboard to 30s-stale silently — this walker fails CI loudly.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename =
  typeof __dirname === 'undefined'
    ? fileURLToPath(import.meta.url)
    : `${__dirname}/__placeholder__`;
const TEST_DIR = typeof __dirname === 'undefined' ? dirname(__filename) : __dirname;
const ADMIN_ROOT = resolve(TEST_DIR, '..', '..', 'app', '(admin)', 'admin');

/**
 * Files known to be read-only — they issue only SELECT statements and
 * have no dashboard-count to invalidate. These are exempt from the
 * source-grep contract.
 */
const READ_ONLY_ALLOWLIST: ReadonlySet<string> = new Set([
  'members/_actions/searchMembers.ts',
  'audit-log/_actions/queryAuditLog.ts',
]);

/**
 * Path-prefixed exclusions for fail-loud server actions that emit an
 * audit breadcrumb but DO NOT mutate domain state. These actions write
 * to `audit_log` (a write the walker correctly flags as INSERT/UPDATE/
 * DELETE-class) but the dashboard counts they would otherwise need to
 * bust are not yet affected — Slice 1 of ADR-0036 ships the fail-loud
 * `initiateRefund` posture before any `refund_requests` row exists, so
 * the dashboard's refund-pending count is structurally unchanged.
 *
 * When Slice 2 of ADR-0036 inverts the env-probe ordering and the
 * action begins inserting a `refund_requests` row, this exclusion MUST
 * be lifted (the action will then emit `revalidateTag(
 * 'admin-dashboard-counts')` per AC35).
 *
 * Match is by `startsWith` on the path returned by `relpath()`, i.e.
 * paths are relative to `app/(admin)/admin/`.
 */
const FAIL_LOUD_PATH_EXCLUSIONS: ReadonlyArray<string> = [
  // ADR-0036 Slice 1 — fail-loud refund initiator. No `refund_requests`
  // INSERT happens; the only DB write is the audit breadcrumb itself.
  // Lift this exclusion in Slice 2 when the action mutates state.
  'payments/refunds/new/_actions/',
];

/**
 * Barrel re-export files — `index.ts` modules that only contain
 * `export { ... } from './...'` lines. These have no executable body
 * and are exempt.
 */
function isBarrelOnly(source: string): boolean {
  // Strip block comments + line comments + blank lines, then assert
  // every remaining line is an import or export statement.
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (stripped.length === 0) return true;
  return stripped.every(
    (line) =>
      /^export\s+(\*|\{)/.test(line) || /^import\s+/.test(line) || /^'server-only';?$/.test(line),
  );
}

function collectActionFiles(root: string): string[] {
  const results: string[] = [];
  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith('.ts')) continue;
      const norm = full.replace(/\\/g, '/');
      if (!/\/_actions\//.test(norm)) continue;
      results.push(full);
    }
  }
  walk(root);
  return results;
}

function relpath(abs: string): string {
  const norm = abs.replace(/\\/g, '/');
  const adminIdx = norm.indexOf('/admin/');
  if (adminIdx < 0) return norm;
  return norm.slice(adminIdx + '/admin/'.length);
}

/**
 * Detect mutation-class SQL keywords in the source. The detection uses
 * a regex that requires `\b` word boundaries so a substring like
 * `inserts` in a comment doesn't trigger. We deliberately do NOT
 * require the keyword to appear inside a template literal — quoted
 * SQL strings (single, double, or backtick) all qualify.
 */
function isMutationClass(source: string): boolean {
  return /\b(INSERT|UPDATE|DELETE)\b/.test(source);
}

describe('dashboard cache invalidation / source-grep', () => {
  const files = collectActionFiles(ADMIN_ROOT);

  it('discovers at least one action file (sanity)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('every mutation-class admin action contains revalidateTag(admin-dashboard-counts)', () => {
    const missing: { file: string; reason: string }[] = [];
    for (const abs of files) {
      const rel = relpath(abs);
      const filename = rel.split('/').pop()!;
      if (filename === 'index.ts') continue; // barrel re-exports
      if (READ_ONLY_ALLOWLIST.has(rel)) continue;
      // ADR-0036 Slice 1: skip fail-loud audit-only actions that emit a
      // breadcrumb but don't mutate domain state. See
      // `FAIL_LOUD_PATH_EXCLUSIONS` JSDoc for the lift-condition.
      if (FAIL_LOUD_PATH_EXCLUSIONS.some((prefix) => rel.startsWith(prefix))) continue;

      const source = readFileSync(abs, 'utf-8');
      if (isBarrelOnly(source)) continue;
      if (!isMutationClass(source)) continue; // pure read action

      // Look for the LITERAL revalidateTag('admin-dashboard-counts') call.
      // Accept either single or double quotes around the tag name; reject
      // any other tag string (a typo would otherwise pass).
      const tagRe = /revalidateTag\(\s*['"]admin-dashboard-counts['"]\s*\)/;
      if (!tagRe.test(source)) {
        missing.push({
          file: rel,
          reason: "missing revalidateTag('admin-dashboard-counts') call",
        });
      }
    }
    expect(missing).toEqual([]);
  });
});
