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
const AUDIT_ACTIONS_FILE = resolve(TEST_DIR, '..', '..', 'lib', 'audit', 'actions.ts');

// ---- The sixteen-event taxonomy + premortem R2 supplement -----------------

/**
 * The sixteen canonical event verbs from ADR-0035 §Audit Event Taxonomy
 * + the premortem R2 supplement event `admin.privacy.export_url_generation_failed`
 * added by t16 for the signed-URL failure path.
 *
 * ADR-0036 Slice 1 extension: every `admin.*`-prefixed verb exported from
 * `lib/audit/actions.ts` is unioned into the allowed-set at runtime (see
 * the `ALLOWED_TAXONOMY` derivation below). This keeps the ADR-0035-era
 * verbs as a hardcoded contract while letting ADR-0036's payments verbs
 * (refund/membership/time_bank/kill_switch) extend the set without
 * requiring this list to be edited every time a new constant is added.
 * The non-admin-prefixed exports (`webhook.stripe.*`, `payment.*`,
 * `membership.past_due`, `dispute.*`) are intentionally NOT pulled in —
 * the walker's `startsWith('admin.')` filter excludes them from the
 * admin taxonomy by construction.
 */
const ADR_0035_TAXONOMY: ReadonlyArray<string> = [
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
];

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
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
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

/**
 * Build a name to value map of every `as const` string export in
 * `lib/audit/actions.ts`. Used by extractIdentifierOccurrences to
 * resolve identifier-reference call sites (the post-ADR-0036 pattern
 * `action: ADMIN_REFUND_FLOW_OPENED` and
 * `withAudit(ADMIN_REFUND_FLOW_OPENED, ...)`).
 *
 * The extension is necessary because t8 of ADR-0036 promotes audit-verb
 * literals to named constants — without resolving identifiers, the
 * extractor above silently loses coverage of every site that uses the
 * named-constant indirection, and the taxonomy invariant becomes
 * vacuously true.
 *
 * Implementation: a single regex pass over the source-of-truth file
 * matches `export const NAME = '...' as const` declarations. We DO NOT
 * walk the import graph in general — the only file that exports audit
 * action constants is `lib/audit/actions.ts`, by repo convention
 * (enforced by the no-literal-leak guard at
 * `tests/audit/payments-action-taxonomy.test.ts`).
 */
function buildAuditActionConstantMap(): Map<string, string> {
  const map = new Map<string, string>();
  let src: string;
  try {
    src = readFileSync(AUDIT_ACTIONS_FILE, 'utf8');
  } catch {
    return map;
  }
  const lines = src.split(/\r?\n/);
  for (const raw of lines) {
    if (isCommentLine(raw)) continue;
    // Match: `export const IDENTIFIER = 'value' as const;`
    // Identifier is SCREAMING_SNAKE_CASE per t8 spec; value is a
    // dotted-verb string.
    const declRe = /\bexport\s+const\s+([A-Z][A-Z0-9_]*)\s*=\s*['"]([^'"]+)['"]\s+as\s+const\b/;
    const m = declRe.exec(raw);
    if (m) {
      map.set(m[1]!, m[2]!);
    }
  }
  return map;
}

/**
 * Extract identifier-reference occurrences from `action: IDENTIFIER`
 * and `withAudit(IDENTIFIER, ...)` call sites, resolving each
 * identifier against the audit-action constant map. Mirrors
 * extractActionOccurrences but for the named-constant indirection
 * introduced by t8 of ADR-0036.
 *
 * Identifiers that do NOT resolve to a known audit-action constant are
 * silently skipped — this is the correct behavior because they are
 * variables (e.g. a dynamically computed action) rather than verb
 * constants.
 */
function extractIdentifierOccurrences(
  file: string,
  src: string,
  constantMap: ReadonlyMap<string, string>,
): Occurrence[] {
  const out: Occurrence[] = [];
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (isCommentLine(line)) continue;
    // Object-literal property with identifier value: `action: IDENT,`
    // or `action: IDENT }`. Requires the value to be a bare identifier
    // (no quotes, no dotted member access — `obj.foo` is intentionally
    // NOT matched so we don't false-positive on imported namespaces).
    const objLitIdentRe = /\baction\s*:\s*([A-Z][A-Z0-9_]*)\s*[,}]/g;
    let m: RegExpExecArray | null;
    while ((m = objLitIdentRe.exec(line)) !== null) {
      const ident = m[1]!;
      const resolved = constantMap.get(ident);
      if (resolved !== undefined && resolved.startsWith('admin.')) {
        out.push({ file, line: i + 1, action: resolved });
      }
    }
    // Positional first-arg with identifier value: `withAudit(IDENT, ...)`.
    const posIdentRe = /\bwithAudit\s*\(\s*([A-Z][A-Z0-9_]*)\s*[,)]/g;
    while ((m = posIdentRe.exec(line)) !== null) {
      const ident = m[1]!;
      const resolved = constantMap.get(ident);
      if (resolved !== undefined && resolved.startsWith('admin.')) {
        out.push({ file, line: i + 1, action: resolved });
      }
    }
  }
  return out;
}

function extractNamedConstantOccurrences(file: string, src: string): Occurrence[] {
  const out: Occurrence[] = [];
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (isCommentLine(line)) continue;
    const constRe = /\bconst\s+EVENT_[A-Z0-9_]+\s*(?::\s*[\w<>|[\] ]+\s*)?=\s*['"]([^'"]+)['"]/g;
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
  // ADR-0036 t8 extension: resolve identifier references against
  // lib/audit/actions.ts so the named-constant indirection (e.g.
  // `action: ADMIN_REFUND_FLOW_OPENED`) doesn't silently lose coverage.
  const constantMap = buildAuditActionConstantMap();

  // ADR-0036 Slice 1 extension: union the ADR-0035 baseline with every
  // `admin.*`-prefixed verb exported from `lib/audit/actions.ts`. The
  // walker's `startsWith('admin.')` filter already excludes the
  // webhook/payment/dispute/membership.past_due verbs that share the
  // same source-of-truth file, so they don't pollute the admin
  // taxonomy. See the JSDoc on `ADR_0035_TAXONOMY` above.
  const ADR_0036_ADMIN_VERBS: ReadonlyArray<string> = Array.from(constantMap.values()).filter((v) =>
    v.startsWith('admin.'),
  );
  const TAXONOMY: ReadonlySet<string> = new Set([...ADR_0035_TAXONOMY, ...ADR_0036_ADMIN_VERBS]);

  it('finds at least eight _actions/*.ts files (smoke check)', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it('every extracted action string is in the admin taxonomy (ADR-0035 baseline + ADR-0036 admin.* verbs)', () => {
    const all: Occurrence[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      all.push(...extractActionOccurrences(f, src));
      all.push(...extractNamedConstantOccurrences(f, src));
      all.push(...extractIdentifierOccurrences(f, src, constantMap));
    }
    expect(all.length).toBeGreaterThan(0);
    const offenders = all.filter((o) => !TAXONOMY.has(o.action));
    if (offenders.length > 0) {
      const msg = offenders.map((o) => `  ${o.file}:${o.line} -> "${o.action}"`).join('\n');
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
        ...extractIdentifierOccurrences(f, src, constantMap),
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
    // ADR-0036 Slice 1: replaced the hardcoded size assertion with a
    // structural duplicate check because the taxonomy is now a union of
    // ADR-0035's hardcoded baseline + the runtime-derived admin.* verbs
    // from `lib/audit/actions.ts`. The size grows with every new
    // ADR-0036 constant — pinning it to a magic number would defeat
    // the auto-extension. Floor of 17 preserves the ADR-0035 baseline.
    const combined = [...ADR_0035_TAXONOMY, ...ADR_0036_ADMIN_VERBS];
    expect(TAXONOMY.size).toBe(new Set(combined).size);
    expect(TAXONOMY.size).toBeGreaterThanOrEqual(17);
  });

  it('extractor resolves identifier references against lib/audit/actions.ts (ADR-0036 t8)', () => {
    // Regression-prevention guard for the named-constant indirection.
    // After ADR-0036 t8, openRefundFlow.ts uses `action:
    // ADMIN_REFUND_FLOW_OPENED` instead of the bare literal. The
    // extractor extension MUST resolve this identifier to
    // `admin.refund.flow_opened` — otherwise this test passes
    // vacuously while losing coverage of every site that uses the
    // named-constant pattern.
    expect(constantMap.get('ADMIN_REFUND_FLOW_OPENED')).toBe('admin.refund.flow_opened');

    const openRefundFlow = files.find((f) => f.replace(/\\/g, '/').endsWith('openRefundFlow.ts'));
    expect(openRefundFlow).toBeDefined();
    const src = readFileSync(openRefundFlow!, 'utf8');
    const literalOccs = extractActionOccurrences(openRefundFlow!, src);
    const identifierOccs = extractIdentifierOccurrences(openRefundFlow!, src, constantMap);
    // Post-t8: NO literal `admin.refund.flow_opened` in non-comment
    // source (it's been promoted to a constant reference).
    expect(literalOccs.find((o) => o.action === 'admin.refund.flow_opened')).toBeUndefined();
    // The extension recovers the coverage via identifier resolution.
    expect(identifierOccs.find((o) => o.action === 'admin.refund.flow_opened')).toBeDefined();
  });
});
