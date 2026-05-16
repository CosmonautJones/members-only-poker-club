/**
 * Payments audit action taxonomy — drift-guard + no-literal-leak tests
 * for `lib/audit/actions.ts` (ADR-0036 Slice 1, AC23 / AC24 / AC25).
 *
 * Run locally:    pnpm test tests/audit/payments-action-taxonomy.test.ts
 * Prerequisites:  none — pure source-text + module-export scan via
 *                 node:fs readFileSync + dynamic import.
 *
 * Spec: docs/specs/0036-payment-management-console-implementation.md
 *       AC23 (22 constants), AC24 (openRefundFlow uses the constant),
 *       AC25 (drift guard + no-literal-leak guard).
 *
 * Contract:
 *   1. All 22 canonical constants are exported from `lib/audit/actions.ts`
 *      with their exact literal string values pinned in AC23.
 *   2. `PaymentsAuditAction` is the 22-typeof union of those constants.
 *   3. Drift guard: parse `docs/adr/0036-payment-management-console.md`
 *      §Audit event taxonomy table and assert every `action` cell is
 *      exported in `lib/audit/actions.ts`. ADR has 21 rows; the constants
 *      file ships 22 (the +1 is `ADMIN_REFUND_FLOW_OPENED` — documented
 *      asymmetry, see asymmetry-explained comment below).
 *   4. No-literal-leak guard: source-grep `app/`, `lib/payments/`,
 *      `lib/audit/` (excluding `lib/audit/actions.ts` + tests) for any
 *      literal matching the payments dotted-verb pattern; fails on any
 *      match.
 *
 * asymmetry-explained: the ADR taxonomy table documents 21 verbs covering
 * Slice 1 + Slice 2 of ADR-0036. The 22nd constant `ADMIN_REFUND_FLOW_OPENED`
 * exists in `lib/audit/actions.ts` to host the legacy literal previously
 * inlined at `app/(admin)/admin/members/[id]/_actions/openRefundFlow.ts`
 * (ADR-0035 origin). Promoting it to a named constant in this file
 * unifies the audit-verb registry for the lint analog (no-literal-leak
 * guard below) and is documented in AC23 prose. The ADR-0036 Audit
 * event taxonomy table is INTENTIONALLY 21 rows (Slice 1 + Slice 2
 * payment verbs only); a retrospective ADR amendment is the documented
 * follow-up (per `.conductor/36/premortem-synthesis.md` §What is NOT in
 * this slice).
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as actions from '@/lib/audit/actions';
import type { PaymentsAuditAction } from '@/lib/audit/actions';

// ---- Path resolution (Windows-safe) ---------------------------------------

const __filename =
  typeof __dirname === 'undefined'
    ? fileURLToPath(import.meta.url)
    : `${__dirname}/__placeholder__`;
const TEST_DIR = typeof __dirname === 'undefined' ? dirname(__filename) : __dirname;
const REPO_ROOT = resolve(TEST_DIR, '..', '..');

const ADR_PATH = resolve(REPO_ROOT, 'docs', 'adr', '0036-payment-management-console.md');
const ACTIONS_FILE = resolve(REPO_ROOT, 'lib', 'audit', 'actions.ts');

const APP_ROOT = resolve(REPO_ROOT, 'app');
const LIB_PAYMENTS_ROOT = resolve(REPO_ROOT, 'lib', 'payments');
const LIB_AUDIT_ROOT = resolve(REPO_ROOT, 'lib', 'audit');

// ---- Expected constants (AC23) --------------------------------------------

interface ExpectedConstant {
  readonly identifier: string;
  readonly value: string;
}

const EXPECTED: readonly ExpectedConstant[] = [
  // 6 refund-flow
  { identifier: 'ADMIN_REFUND_INITIATED', value: 'admin.refund.initiated' },
  { identifier: 'ADMIN_REFUND_COMPLETED', value: 'admin.refund.completed' },
  { identifier: 'ADMIN_REFUND_FAILED', value: 'admin.refund.failed' },
  { identifier: 'ADMIN_REFUND_DENIED', value: 'admin.refund.denied' },
  { identifier: 'ADMIN_REFUND_SETTLED', value: 'admin.refund.settled' },
  { identifier: 'ADMIN_REFUND_FLOW_OPENED', value: 'admin.refund.flow_opened' },
  // 4 membership-override
  {
    identifier: 'ADMIN_MEMBERSHIP_STATUS_OVERRIDDEN',
    value: 'admin.membership.status_overridden',
  },
  { identifier: 'ADMIN_MEMBERSHIP_CANCELED', value: 'admin.membership.canceled' },
  { identifier: 'ADMIN_MEMBERSHIP_REACTIVATED', value: 'admin.membership.reactivated' },
  { identifier: 'ADMIN_MEMBERSHIP_GRACE_EXTENDED', value: 'admin.membership.grace_extended' },
  // 2 time-bank manual
  { identifier: 'ADMIN_TIME_BANK_MANUAL_CREDIT', value: 'admin.time_bank.manual_credit' },
  { identifier: 'ADMIN_TIME_BANK_MANUAL_DEBIT', value: 'admin.time_bank.manual_debit' },
  // 1 kill-switch
  { identifier: 'ADMIN_KILL_SWITCH_TOGGLED', value: 'admin.kill_switch.toggled' },
  // 4 webhook lifecycle
  { identifier: 'WEBHOOK_STRIPE_RECEIVED', value: 'webhook.stripe.received' },
  { identifier: 'WEBHOOK_STRIPE_PROCESSED', value: 'webhook.stripe.processed' },
  { identifier: 'WEBHOOK_STRIPE_FAILED', value: 'webhook.stripe.failed' },
  { identifier: 'WEBHOOK_STRIPE_SKIPPED_KILL_SWITCH', value: 'webhook.stripe.skipped_kill_switch' },
  // 5 webhook side-effects
  { identifier: 'PAYMENT_SUCCEEDED', value: 'payment.succeeded' },
  { identifier: 'PAYMENT_FAILED', value: 'payment.failed' },
  { identifier: 'MEMBERSHIP_PAST_DUE', value: 'membership.past_due' },
  { identifier: 'DISPUTE_OPENED', value: 'dispute.opened' },
  { identifier: 'DISPUTE_CLOSED', value: 'dispute.closed' },
];

// ---- File walker (no-literal-leak guard) ----------------------------------

/**
 * Recursively collect every `.ts`/`.tsx` file under a root directory,
 * excluding test files and the actions.ts source-of-truth itself.
 */
function collectScannableFiles(roots: readonly string[]): string[] {
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
        if (entry === 'node_modules' || entry === '.next') continue;
        walk(full);
        continue;
      }
      if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue;
      // Exclude tests + the source-of-truth file.
      if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) continue;
      if (entry.endsWith('.spec.ts') || entry.endsWith('.spec.tsx')) continue;
      if (resolve(full) === ACTIONS_FILE) continue;
      results.push(full);
    }
  }
  for (const root of roots) walk(root);
  return results;
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

// ---- ADR taxonomy table parser --------------------------------------------

/**
 * Parse the ADR Audit event taxonomy markdown table and extract every
 * `action` column cell value. The table starts after `## Audit event
 * taxonomy` and ends at the next blank line that follows the table rows.
 */
function parseAdrTaxonomyTable(adrSrc: string): string[] {
  const lines = adrSrc.split(/\r?\n/);
  let inSection = false;
  let inTable = false;
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw;
    if (/^##\s+Audit event taxonomy\b/.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s+/.test(line)) {
      break;
    }
    if (!inSection) continue;
    // The table header row contains `| Action |`; rows we want start
    // with `| ` followed by a backticked action string.
    if (/^\|\s*Action\s*\|/.test(line)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    // Separator row: `|---|---|...`
    if (/^\|\s*-+\s*\|/.test(line)) continue;
    // Trailing blank line — end of table.
    if (line.trim() === '') {
      inTable = false;
      continue;
    }
    // Data row: extract the first `| `...` |` cell, then pull the
    // backticked action value.
    const m = /^\|\s*`([^`]+)`\s*\|/.exec(line);
    if (m) {
      out.push(m[1]!);
    }
  }
  return out;
}

// ---- Suite body -----------------------------------------------------------

describe('AC23 — all 22 audit-verb constants are exported with exact literal values', () => {
  it.each(EXPECTED)(
    'exports $identifier === "$value"',
    ({ identifier, value }: ExpectedConstant) => {
      const map = actions as Record<string, unknown>;
      expect(map[identifier]).toBe(value);
    },
  );

  it('exports exactly 22 distinct constants (drift detector for over-export)', () => {
    const stringExports = Object.entries(actions).filter(([, v]) => typeof v === 'string');
    expect(stringExports).toHaveLength(EXPECTED.length);
    expect(EXPECTED).toHaveLength(22);
  });

  it('no two constants share the same value (inverse-uniqueness)', () => {
    const values = EXPECTED.map((c) => c.value);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});

describe('AC23 — PaymentsAuditAction is the 22-typeof union', () => {
  it('the union contains every expected literal value at the type level', () => {
    // Type-level assertion: every expected literal value is assignable
    // to PaymentsAuditAction. If the union drifts (e.g. someone removes
    // a `typeof` branch), this block fails to typecheck.
    expectTypeOf<'admin.refund.initiated'>().toMatchTypeOf<PaymentsAuditAction>();
    expectTypeOf<'admin.refund.completed'>().toMatchTypeOf<PaymentsAuditAction>();
    expectTypeOf<'admin.refund.failed'>().toMatchTypeOf<PaymentsAuditAction>();
    expectTypeOf<'admin.refund.denied'>().toMatchTypeOf<PaymentsAuditAction>();
    expectTypeOf<'admin.refund.settled'>().toMatchTypeOf<PaymentsAuditAction>();
    expectTypeOf<'admin.refund.flow_opened'>().toMatchTypeOf<PaymentsAuditAction>();
    expectTypeOf<'admin.membership.status_overridden'>().toMatchTypeOf<PaymentsAuditAction>();
    expectTypeOf<'admin.membership.canceled'>().toMatchTypeOf<PaymentsAuditAction>();
    expectTypeOf<'admin.membership.reactivated'>().toMatchTypeOf<PaymentsAuditAction>();
    expectTypeOf<'admin.membership.grace_extended'>().toMatchTypeOf<PaymentsAuditAction>();
    expectTypeOf<'admin.time_bank.manual_credit'>().toMatchTypeOf<PaymentsAuditAction>();
    expectTypeOf<'admin.time_bank.manual_debit'>().toMatchTypeOf<PaymentsAuditAction>();
    expectTypeOf<'admin.kill_switch.toggled'>().toMatchTypeOf<PaymentsAuditAction>();
    expectTypeOf<'webhook.stripe.received'>().toMatchTypeOf<PaymentsAuditAction>();
    expectTypeOf<'webhook.stripe.processed'>().toMatchTypeOf<PaymentsAuditAction>();
    expectTypeOf<'webhook.stripe.failed'>().toMatchTypeOf<PaymentsAuditAction>();
    expectTypeOf<'webhook.stripe.skipped_kill_switch'>().toMatchTypeOf<PaymentsAuditAction>();
    expectTypeOf<'payment.succeeded'>().toMatchTypeOf<PaymentsAuditAction>();
    expectTypeOf<'payment.failed'>().toMatchTypeOf<PaymentsAuditAction>();
    expectTypeOf<'membership.past_due'>().toMatchTypeOf<PaymentsAuditAction>();
    expectTypeOf<'dispute.opened'>().toMatchTypeOf<PaymentsAuditAction>();
    expectTypeOf<'dispute.closed'>().toMatchTypeOf<PaymentsAuditAction>();
    // Inverse: PaymentsAuditAction is NOT just `string`.
    expectTypeOf<PaymentsAuditAction>().not.toEqualTypeOf<string>();
  });

  it('the runtime constants satisfy PaymentsAuditAction at the type level', () => {
    // Bind each constant to a typed slot — fails to compile if any
    // constant's value-type is widened away from its literal.
    const slots: readonly PaymentsAuditAction[] = [
      actions.ADMIN_REFUND_INITIATED,
      actions.ADMIN_REFUND_COMPLETED,
      actions.ADMIN_REFUND_FAILED,
      actions.ADMIN_REFUND_DENIED,
      actions.ADMIN_REFUND_SETTLED,
      actions.ADMIN_REFUND_FLOW_OPENED,
      actions.ADMIN_MEMBERSHIP_STATUS_OVERRIDDEN,
      actions.ADMIN_MEMBERSHIP_CANCELED,
      actions.ADMIN_MEMBERSHIP_REACTIVATED,
      actions.ADMIN_MEMBERSHIP_GRACE_EXTENDED,
      actions.ADMIN_TIME_BANK_MANUAL_CREDIT,
      actions.ADMIN_TIME_BANK_MANUAL_DEBIT,
      actions.ADMIN_KILL_SWITCH_TOGGLED,
      actions.WEBHOOK_STRIPE_RECEIVED,
      actions.WEBHOOK_STRIPE_PROCESSED,
      actions.WEBHOOK_STRIPE_FAILED,
      actions.WEBHOOK_STRIPE_SKIPPED_KILL_SWITCH,
      actions.PAYMENT_SUCCEEDED,
      actions.PAYMENT_FAILED,
      actions.MEMBERSHIP_PAST_DUE,
      actions.DISPUTE_OPENED,
      actions.DISPUTE_CLOSED,
    ];
    expect(slots).toHaveLength(22);
  });
});

describe('AC25 — drift guard: every ADR Audit event taxonomy row is exported', () => {
  // asymmetry-explained: the ADR table is 21 rows (Slice 1 + Slice 2
  // payment verbs only). The constants file exports 22 — the +1 is
  // `ADMIN_REFUND_FLOW_OPENED`, which promotes the ADR-0035-era literal
  // in `app/(admin)/admin/members/[id]/_actions/openRefundFlow.ts` to
  // a named constant. The asymmetry is documented in AC23 prose and is
  // a retrospective ADR-amendment follow-up
  // (see `.conductor/36/premortem-synthesis.md`).
  const expectedAdrRowCount = 21;
  const actualConstantCount = 22;

  it('parses 21 action cells from the ADR taxonomy table (asymmetry-explained)', () => {
    const adrSrc = readFileSync(ADR_PATH, 'utf8');
    const cells = parseAdrTaxonomyTable(adrSrc);
    expect(cells).toHaveLength(expectedAdrRowCount);
    expect(EXPECTED).toHaveLength(actualConstantCount);
    // The off-by-one is the documented asymmetry.
    expect(actualConstantCount - expectedAdrRowCount).toBe(1);
  });

  it('every ADR action cell value is exported in lib/audit/actions.ts', () => {
    const adrSrc = readFileSync(ADR_PATH, 'utf8');
    const cells = parseAdrTaxonomyTable(adrSrc);
    // Widen via `unknown` so the type predicate is structurally valid;
    // every runtime value happens to satisfy the literal union, but
    // the type system sees a narrowed view of Object.values' output.
    const exportedValues = new Set<string>(
      (Object.values(actions) as unknown[]).filter((v): v is string => typeof v === 'string'),
    );
    const missing = cells.filter((c) => !exportedValues.has(c));
    if (missing.length > 0) {
      throw new Error(
        `AC25 drift: ${missing.length} ADR action cell(s) absent from lib/audit/actions.ts:\n` +
          missing.map((c) => `  - "${c}"`).join('\n'),
      );
    }
  });

  it('admin.refund.flow_opened is the single documented asymmetry (+1)', () => {
    const adrSrc = readFileSync(ADR_PATH, 'utf8');
    const cells = new Set(parseAdrTaxonomyTable(adrSrc));
    expect(cells.has('admin.refund.flow_opened')).toBe(false);
    expect(actions.ADMIN_REFUND_FLOW_OPENED).toBe('admin.refund.flow_opened');
  });
});

describe('AC25 — no-literal-leak guard', () => {
  // Source-of-truth pattern: any literal matching this regex outside
  // `lib/audit/actions.ts` + tests must be a constant reference instead.
  const LEAK_RE =
    /['"](admin\.refund|admin\.membership|admin\.time_bank|admin\.kill_switch|webhook\.stripe|payment\.succeeded|payment\.failed|membership\.past_due|dispute\.opened|dispute\.closed)\.[a-z_]+['"]/;

  it('no payments audit-verb literal appears in app/, lib/payments/, lib/audit/ (excluding actions.ts + tests)', () => {
    const files = collectScannableFiles([APP_ROOT, LIB_PAYMENTS_ROOT, LIB_AUDIT_ROOT]);
    // Smoke check — the walker should find at least a few files.
    expect(files.length).toBeGreaterThan(0);

    interface Leak {
      file: string;
      line: number;
      match: string;
    }
    const leaks: Leak[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const lines = src.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]!;
        if (isCommentLine(line)) continue;
        const m = LEAK_RE.exec(line);
        if (m) {
          leaks.push({ file: f, line: i + 1, match: m[0] });
        }
      }
    }

    if (leaks.length > 0) {
      const msg = leaks.map((l) => `  ${l.file}:${l.line} -> ${l.match}`).join('\n');
      throw new Error(
        `AC25 no-literal-leak violation: ${leaks.length} payments-verb literal(s) outside lib/audit/actions.ts:\n${msg}\n\n` +
          `Replace each literal with the named constant from @/lib/audit/actions.`,
      );
    }
  });
});

describe('AC24 — openRefundFlow.ts references ADMIN_REFUND_FLOW_OPENED identifier', () => {
  // Belt-and-suspenders: even with the audit-event-taxonomy extractor
  // extension (which resolves identifier references), pin a direct
  // source-grep assertion here so future contributors get a clear
  // failure mode if the identifier is accidentally rebound.
  const ACTION_PATH = resolve(
    REPO_ROOT,
    'app',
    '(admin)',
    'admin',
    'members',
    '[id]',
    '_actions',
    'openRefundFlow.ts',
  );

  it('imports ADMIN_REFUND_FLOW_OPENED from @/lib/audit/actions', () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    expect(src).toMatch(
      /import[^;]*\bADMIN_REFUND_FLOW_OPENED\b[^;]*from\s*['"]@\/lib\/audit\/actions['"]/,
    );
  });

  it('references ADMIN_REFUND_FLOW_OPENED at the withAudit call site (not the literal)', () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    // Strip block + line comments to avoid false positives from JSDoc.
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(stripped).toMatch(/\baction\s*:\s*ADMIN_REFUND_FLOW_OPENED\b/);
    // The bare literal must not appear in stripped (non-comment) source.
    expect(stripped).not.toMatch(/['"]admin\.refund\.flow_opened['"]/);
  });
});
