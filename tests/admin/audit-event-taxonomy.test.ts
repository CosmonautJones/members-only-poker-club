/**
 * Cross-cutting source-grep test for the admin audit event taxonomy
 * (ADR-0035 AC27, WD.T18 / t21).
 *
 * Run locally:    pnpm test tests/admin/audit-event-taxonomy.test.ts
 * Prerequisites:  none — pure source-text scan via node:fs readFileSync,
 *                 no DB / network / child_process.
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC27.
 *
 * Contract:
 *   - Walk every `app/(admin)/admin/**\/_actions/*.ts` file.
 *   - Extract every action-string from `withAudit({ action, ... })`
 *     object literals AND `withAudit('...', ...)` positional calls AND
 *     `const EVENT_FOO = 'admin.foo'` named-constant declarations
 *     (which `updateFlag.ts` uses for most-specific-first dispatch).
 *   - Assert every extracted action string appears in the sixteen-event
 *     taxonomy list from ADR-0035 §Audit Event Taxonomy, PLUS the
 *     premortem R2 event `admin.privacy.export_url_generation_failed`.
 *   - Assert intra-file uniqueness (no duplicate action strings inside
 *     one file).
 *   - The Slice 4D session events (`admin.session.entered`,
 *     `admin.session.role_check_denied`) are emitted from
 *     `lib/auth/requireRole.ts` (AC34) — they live in the taxonomy
 *     even if not yet emitted by the _actions tree.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- Path resolution (Windows-safe) ---------------------------------------

const __filename =
  typeof __dirname === 'undefined'
    ? fileURLToPath(import.meta.url)
    : `${__dirname}/__placeholder__`;
const TEST_DIR = typeof __dirname === 'undefined' ? dirname(__filename) : __dirname;
const ADMIN_ROOT = resolve(TEST_DIR, '..', '..', 'app', '(admin)', 'admin');

// ---- The sixteen-event taxonomy + premortem R2 supplement -----------------

/**
 * The sixteen canonical event verbs from ADR-0035 §Audit Event Taxonomy
 * + the premortem R2 supplement event `admin.privacy.export_url_generation_failed`
 * added by t16 for the signed-URL failure path.
 */
const TAXONOMY: ReadonlySet<string> = new Set([
  // Member lifecycle (3)
  'admin.member.role_changed',
  'admin.member.reverification_requested',
  'admin.member.deletion_initiated',
  // Verification queue (3)
  'admin.verification.approved',
  'admin.verification.rejected',
  'admin.verification.info_requested',
  // Feature-flag mutations (4)
  'admin.flag.toggled',
  'admin.flag.percent_changed',
  'admin.flag.allowlist_changed',
  'admin.flag.role_gate_changed',
  // Privacy queue (3)
  'admin.privacy.export_approved',
  'admin.privacy.deletion_approved',
  'admin.privacy.request_rejected',
  // Misc admin breadcrumb / session (3)
  'admin.refund.flow_opened',
  'admin.session.entered',
  'admin.session.role_check_denied',
  // Premortem R2 supplement (t16) — signed-URL generation failure
  'admin.privacy.export_url_generation_failed',
]);

// ---- File walker ----------------------------------------------------------

/**
 * Recursively collect every `.ts` file under any `_actions` directory
 * within `app/(admin)/admin/`.
 */
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

// ---- Action-string extractor ----------------------------------------------

interface Occurrence {
  file: string;
  line: number;
  action: string;
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*')
  );
}

function extractActionOccurrences(file: string, src: string): Occurrence[] {
  const out: Occurrence[] = [];
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (isCommentLine(line)) continue;
    // Object-literal property: `action: 'admin.foo.bar'`.
    const objLitRe = /\baction\s*:\s*['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = objLitRe.exec(line)) !== null) {
      const a = m[1]!;
      if (a.startsWith('admin.')) {
        out.push({ file, line: i + 1, action: a });
      }
    }
    // Positional: `withAudit('admin.foo.bar', ...)`.
    const posRe = /\bwithAudit\s*\(\s*['"]([^'"]+)['"]/g;
    while ((m = posRe.exec(line)) !== null) {
      const a = m[1]!;
      if (a.startsWith('admin.')) {
        out.push({ file, line: i + 1, action: a });
      }
    }
  }
  return out;
}

function extractNamedConstantOccurrences(
  file: string,
  src: string,
): Occurrence[] {
  const out: Occurrence[] = [];
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (isCommentLine(line)) continue;
    const constRe =
      /\bconst\s+EVENT_[A-Z0-9_]+\s*(?::\s*[\w<>|[\] ]+\s*)?=\s*['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = constRe.exec(line)) !== null) {
      const a = m[1]!;
      if (a.startsWith('admin.')) {
        out.push({ file, line: i + 1, action: a });
      }
    }
  }
  return out;
}

// ---- Suite body -----------------------------------------------------------

describe('AC27 — admin audit event taxonomy is exhaustive and unique', () => {
  const files = collectActionFiles(ADMIN_ROOT);

  it('finds at least eight _actions/*.ts files (smoke check)', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it('every extracted action string is in the seventeen-event taxonomy', () => {
    const all: Occurrence[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      all.push(...extractActionOccurrences(f, src));
      all.push(...extractNamedConstantOccurrences(f, src));
    }
    expect(all.length).toBeGreaterThan(0);
    const offenders = all.filter((o) => !TAXONOMY.has(o.action));
    if (offenders.length > 0) {
      const msg = offenders
        .map((o) => `  ${o.file}:${o.line} -> "${o.action}"`)
        .join('\n');
      throw new Error(
        `AC27 taxonomy violation: ${offenders.length} action string(s) outside the taxonomy:\n${msg}\n\n` +
          `Allowed verbs: ${[...TAXONOMY].sort().join(', ')}`,
      );
    }
  });

  it('no two distinct emit sites within one file share the same action string (intra-file uniqueness)', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const occs = [
        ...extractActionOccurrences(f, src),
        ...extractNamedConstantOccurrences(f, src),
      ];
      const seen = new Set<string>();
      const dupes: string[] = [];
      for (const o of occs) {
        if (seen.has(o.action)) dupes.push(o.action);
        seen.add(o.action);
      }
      if (dupes.length > 0) {
        throw new Error(
          `AC27 intra-file uniqueness violation in ${f}: duplicate action strings ${dupes.join(', ')}`,
        );
      }
    }
  });

  it('the taxonomy itself has no duplicates (sanity check)', () => {
    expect(TAXONOMY.size).toBe(17);
  });
});
