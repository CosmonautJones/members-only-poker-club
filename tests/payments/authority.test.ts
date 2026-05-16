/**
 * Unit tests for `lib/payments/authority.ts` + `lib/auth/roleAtLeast.ts`
 * (ADR-0036 Slice 1, t6, AC17 + AC18).
 *
 * Run locally:    pnpm test tests/payments/authority.test.ts
 * Prerequisites:  none — pure module mocks, no DB, no network.
 *
 * Spec: docs/specs/0036-payment-management-console-implementation.md AC17, AC18.
 * Module under test: lib/payments/authority.ts (pure runtime guard:
 *   RefundType union, InsufficientAuthorityError, requiredRoleFor,
 *   assertRefundAuthority).
 * Helper under test: lib/auth/roleAtLeast.ts (typed `roleAtLeast(have, need)`
 *   helper — separate module from lib/auth/types.ts so its load-bearing
 *   `import 'server-only';` directive does not break the types.ts
 *   "types are erased" invariant; see authority premortem R10).
 *
 * Mocking strategy:
 *   - vi.mock('server-only') so the directive at the top of each SUT does
 *     not throw under the test runtime (standard repo pattern — see
 *     tests/audit/with-audit.test.ts, tests/auth/getCurrentProfile.test.ts).
 *
 * AC18 authority lookup table (10 rows × 4 roles = 40 cells, plus
 * boundary sentinels):
 *
 * | refundType          | amount       | member | cashier | manager | owner |
 * |---------------------|--------------|--------|---------|---------|-------|
 * | time_bank           | 1c (boundary)| deny   | allow   | allow   | allow |
 * | time_bank           | 2500c        | deny   | allow   | allow   | allow |
 * | time_bank           | 2501c        | deny   | deny    | allow   | allow |
 * | time_bank           | 20000c       | deny   | deny    | allow   | allow |
 * | time_bank           | 20001c       | deny   | deny    | deny    | allow |
 * | time_bank           | 50000c       | deny   | deny    | deny    | allow |
 * | membership_current  | 100c         | deny   | deny    | allow   | allow |
 * | membership_current  | 10000000c    | deny   | deny    | allow   | allow |
 * | membership_previous | 100c         | deny   | deny    | deny    | allow |
 * | membership_previous | 10000000c    | deny   | deny    | deny    | allow |
 *
 * Premortem-binding additions (see .conductor/36/returns/0006-premortem-authority.md):
 *   - R1: explicit boundary cells (2500/2501, 20000/20001) — load-bearing.
 *   - R2: runtime guard rejects -1, NaN, Infinity, 0.5 with RangeError.
 *   - R3: monthsBack accepted-but-ignored sentinel (0 / 12 / undefined identical).
 *   - R4: unknown RefundType cast falls through to `throw new TypeError`.
 *   - R5: roleAtLeast operand-direction (have/need) test.
 *   - R6: InsufficientAuthorityError.toJSON() redaction.
 *   - R7: exhaustiveness meta-assertion (Set(seen) === Set(REFUND_TYPES_DECLARED)).
 *   - R10: source-grep `import 'server-only';` on authority.ts AND roleAtLeast.ts.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cents, type Cents } from '@/lib/money/types';
import type { Role } from '@/lib/auth/types';

import {
  type RefundType,
  InsufficientAuthorityError,
  requiredRoleFor,
  assertRefundAuthority,
} from '@/lib/payments/authority';
import { roleAtLeast } from '@/lib/auth/roleAtLeast';

// Neutralize `server-only` so importing the SUTs does not throw under the
// vitest runtime (standard repo pattern).
import { vi } from 'vitest';
vi.mock('server-only', () => ({}));

// ---------------------------------------------------------------------------
// Test data — the 10 AC18 rows, each typed against the union so a future
// RefundType addition (R7) without an accompanying table-row addition fails
// the TypeScript check at this line.
// ---------------------------------------------------------------------------

type AuthorityCell = {
  refundType: RefundType;
  amountCents: number;
  allow: ReadonlyArray<Role>;
};

// Source of truth for the meta-assertion in R7. If a future contributor
// adds a new variant to `RefundType` without updating this array,
// TypeScript fails here AND the meta-assertion below catches the drift at
// runtime.
const REFUND_TYPES_DECLARED: ReadonlyArray<RefundType> = [
  'time_bank',
  'membership_current',
  'membership_previous',
];

const ALL_ROLES: ReadonlyArray<Role> = ['member', 'cashier', 'manager', 'owner'];

const AUTHORITY_TABLE: ReadonlyArray<AuthorityCell> = [
  // time_bank
  { refundType: 'time_bank', amountCents: 1, allow: ['cashier', 'manager', 'owner'] },
  { refundType: 'time_bank', amountCents: 2500, allow: ['cashier', 'manager', 'owner'] },
  { refundType: 'time_bank', amountCents: 2501, allow: ['manager', 'owner'] },
  { refundType: 'time_bank', amountCents: 20000, allow: ['manager', 'owner'] },
  { refundType: 'time_bank', amountCents: 20001, allow: ['owner'] },
  { refundType: 'time_bank', amountCents: 50000, allow: ['owner'] },
  // membership_current
  { refundType: 'membership_current', amountCents: 100, allow: ['manager', 'owner'] },
  {
    refundType: 'membership_current',
    amountCents: 10_000_000,
    allow: ['manager', 'owner'],
  },
  // membership_previous
  { refundType: 'membership_previous', amountCents: 100, allow: ['owner'] },
  { refundType: 'membership_previous', amountCents: 10_000_000, allow: ['owner'] },
];

// Expected `required` role for a given (refundType, amountCents) cell, used
// for asserting the deny-side error payload. Mirrors the matrix in
// requiredRoleFor without reimplementing it (it just reads from the table's
// allow-list head).
function expectedRequired(cell: AuthorityCell): Role {
  // The lowest role in `allow` is the floor — `requiredRoleFor` returns
  // this exact role. (member < cashier < manager < owner.)
  const first = cell.allow[0];
  // `allow` is non-empty for every row in AUTHORITY_TABLE — assert here so
  // a future row mistake fails loudly instead of silently returning undefined.
  if (!first) {
    throw new Error('AUTHORITY_TABLE row has empty allow[] — fix the row');
  }
  return first;
}

describe('lib/payments/authority — requiredRoleFor (AC17, AC18)', () => {
  // -----------------------------------------------------------------------
  // The 40-cell matrix — assertRefundAuthority allow/deny for every
  // (role × refundType × amountCents) tuple. Allow paths resolve void;
  // deny paths reject with InsufficientAuthorityError carrying the
  // expected payload.
  // -----------------------------------------------------------------------
  for (const cell of AUTHORITY_TABLE) {
    for (const role of ALL_ROLES) {
      const isAllow = cell.allow.includes(role);
      const label =
        `${role} × ${cell.refundType} × ${cell.amountCents}c → ` + (isAllow ? 'allow' : 'deny');

      it(label, async () => {
        const amount = cents(cell.amountCents);
        const promise = assertRefundAuthority({
          actorRole: role,
          amountCents: amount,
          refundType: cell.refundType,
        });

        if (isAllow) {
          await expect(promise).resolves.toBeUndefined();
        } else {
          await expect(promise).rejects.toBeInstanceOf(InsufficientAuthorityError);
          await expect(promise).rejects.toMatchObject({
            actorRole: role,
            required: expectedRequired(cell),
            refundType: cell.refundType,
            amountCents: amount,
          });
        }
      });
    }
  }

  // -----------------------------------------------------------------------
  // Direct boundary math (R1) — `requiredRoleFor` exercised without the
  // `assertRefundAuthority` wrapper, so a `<=` → `<` regression in the
  // helper fails one named, easy-to-read assertion.
  // -----------------------------------------------------------------------
  describe('requiredRoleFor — direct boundary math (R1)', () => {
    it('time_bank ≤ 2500c → cashier (lower boundary inclusive)', () => {
      expect(requiredRoleFor('time_bank', cents(1))).toBe('cashier');
      expect(requiredRoleFor('time_bank', cents(2500))).toBe('cashier');
    });

    it('time_bank 2501c → manager (just over the cashier cap)', () => {
      expect(requiredRoleFor('time_bank', cents(2501))).toBe('manager');
    });

    it('time_bank ≤ 20000c → manager (upper boundary inclusive)', () => {
      expect(requiredRoleFor('time_bank', cents(20000))).toBe('manager');
    });

    it('time_bank 20001c → owner (just over the manager cap)', () => {
      expect(requiredRoleFor('time_bank', cents(20001))).toBe('owner');
    });

    it('membership_current → manager regardless of amount', () => {
      expect(requiredRoleFor('membership_current', cents(0))).toBe('manager');
      expect(requiredRoleFor('membership_current', cents(100))).toBe('manager');
      expect(requiredRoleFor('membership_current', cents(10_000_000))).toBe('manager');
    });

    it('membership_previous → owner regardless of amount', () => {
      expect(requiredRoleFor('membership_previous', cents(0))).toBe('owner');
      expect(requiredRoleFor('membership_previous', cents(100))).toBe('owner');
      expect(requiredRoleFor('membership_previous', cents(10_000_000))).toBe('owner');
    });

    // R9 — exercise the cents(...) constructor path, not just integer
    // literals, to pin the documented unit convention (amountCents is
    // integer cents, NOT dollars; 25 → $0.25, not $25).
    it('honors the integer-cents unit convention via cents(25)', () => {
      expect(requiredRoleFor('time_bank', cents(25))).toBe('cashier');
    });

    // R3 — `monthsBack` is accepted but ignored in v1. Any future
    // branch on it requires an ADR-0027 amendment AND an AC18 table-row
    // addition. The sentinel proves the parameter is a no-op.
    it('monthsBack is a no-op in v1 (0 / 12 / undefined → identical results)', async () => {
      const params = {
        actorRole: 'owner' as Role,
        amountCents: cents(100),
        refundType: 'membership_previous' as RefundType,
      };
      await expect(assertRefundAuthority({ ...params, monthsBack: 0 })).resolves.toBeUndefined();
      await expect(assertRefundAuthority({ ...params, monthsBack: 12 })).resolves.toBeUndefined();
      await expect(assertRefundAuthority(params)).resolves.toBeUndefined();

      // And the deny side — same role/refund-type combo for a manager
      // is denied regardless of monthsBack.
      const deny = {
        actorRole: 'manager' as Role,
        amountCents: cents(100),
        refundType: 'membership_previous' as RefundType,
      };
      await expect(assertRefundAuthority({ ...deny, monthsBack: 0 })).rejects.toBeInstanceOf(
        InsufficientAuthorityError,
      );
      await expect(assertRefundAuthority({ ...deny, monthsBack: 12 })).rejects.toBeInstanceOf(
        InsufficientAuthorityError,
      );
      await expect(assertRefundAuthority(deny)).rejects.toBeInstanceOf(InsufficientAuthorityError);
    });
  });

  // -----------------------------------------------------------------------
  // Runtime guard sentinels (R2) — the `Cents` brand is structural-only;
  // a future caller passing a raw number bypasses the TS check. The
  // runtime guard at the top of `requiredRoleFor` MUST reject
  // non-integer / negative / non-finite inputs with RangeError.
  // -----------------------------------------------------------------------
  describe('requiredRoleFor — runtime guard sentinels (R2)', () => {
    it('rejects negative amountCents with RangeError', () => {
      expect(() => requiredRoleFor('time_bank', -1 as Cents)).toThrow(RangeError);
    });

    it('rejects NaN amountCents with RangeError', () => {
      expect(() => requiredRoleFor('time_bank', NaN as Cents)).toThrow(RangeError);
    });

    it('rejects Infinity amountCents with RangeError', () => {
      expect(() => requiredRoleFor('time_bank', Number.POSITIVE_INFINITY as Cents)).toThrow(
        RangeError,
      );
    });

    it('rejects non-integer (fractional) amountCents with RangeError', () => {
      expect(() => requiredRoleFor('time_bank', 0.5 as Cents)).toThrow(RangeError);
    });

    it('accepts 0 cents (degenerate but valid integer; owner-only for membership_previous)', () => {
      // 0 satisfies the guard (integer + non-negative). The matrix says
      // time_bank with amount ≤ 2500 → cashier, so 0c → cashier.
      expect(requiredRoleFor('time_bank', cents(0))).toBe('cashier');
    });

    it('assertRefundAuthority propagates the RangeError to the caller', async () => {
      await expect(
        assertRefundAuthority({
          actorRole: 'owner',
          amountCents: -1 as Cents,
          refundType: 'time_bank',
        }),
      ).rejects.toBeInstanceOf(RangeError);
    });
  });

  // -----------------------------------------------------------------------
  // Exhaustiveness throws (R4) — the trailing `const _: never = refundType`
  // line in `requiredRoleFor` MUST throw TypeError, NOT silently return
  // the runtime value of `refundType` (which TS erases to a plain string).
  // -----------------------------------------------------------------------
  describe('requiredRoleFor — exhaustiveness (R4)', () => {
    it('throws TypeError on an unknown refundType (cast bypass)', () => {
      // Cast bypasses the compile-time RefundType narrowing — simulates a
      // future caller whose Zod schema uses `.string()` instead of
      // `.enum([...])`, so a malformed form field lands at this gate.
      expect(() => requiredRoleFor('refund_credit' as RefundType, cents(100))).toThrow(TypeError);
    });
  });

  // -----------------------------------------------------------------------
  // InsufficientAuthorityError.toJSON() redaction (R6) — JSON.stringify
  // MUST NOT include operationally-sensitive `actorRole` or `amountCents`
  // (role + money pairing is internal disclosure even if not PII per
  // ADR-0035 AC28). Mirrors the StripeNotConfiguredError redaction
  // posture in AC22.
  // -----------------------------------------------------------------------
  describe('InsufficientAuthorityError.toJSON() redaction (R6)', () => {
    const err = new InsufficientAuthorityError(
      'manager',
      'owner',
      'membership_previous',
      cents(50000),
    );

    it('JSON.stringify omits actorRole', () => {
      expect(JSON.stringify(err)).not.toMatch(/manager/);
    });

    it('JSON.stringify omits amountCents', () => {
      expect(JSON.stringify(err)).not.toMatch(/50000/);
    });

    it('JSON.stringify includes required + refundType', () => {
      const serialized = JSON.stringify(err);
      expect(serialized).toMatch(/owner/);
      expect(serialized).toMatch(/membership_previous/);
      expect(serialized).toMatch(/required/);
      expect(serialized).toMatch(/refundType/);
    });

    it('JSON.stringify includes the error name', () => {
      expect(JSON.stringify(err)).toMatch(/InsufficientAuthorityError/);
    });

    it('field access bypasses toJSON (server-side error.actorRole still works)', () => {
      // The redaction posture protects JSON serialization (Sentry's
      // default path); direct field access on the live error object
      // remains available for server-side audit-row writers.
      expect(err.actorRole).toBe('manager');
      expect(err.amountCents).toBe(50000);
      expect(err.required).toBe('owner');
      expect(err.refundType).toBe('membership_previous');
    });

    it('error.name is "InsufficientAuthorityError"', () => {
      expect(err.name).toBe('InsufficientAuthorityError');
    });

    it('error.message names the role and refundType for forensic logs', () => {
      // The `message` field is the log-friendly version; it carries the
      // operationally-sensitive details. It is NOT what `toJSON()`
      // emits — that path is redacted above.
      expect(err.message).toMatch(/manager/);
      expect(err.message).toMatch(/owner/);
      expect(err.message).toMatch(/membership_previous/);
    });
  });

  // -----------------------------------------------------------------------
  // Meta-assertion (R7) — the test's row-count covers every
  // RefundType union member. Adding a new variant without adding cells
  // to AUTHORITY_TABLE fails this assertion.
  // -----------------------------------------------------------------------
  describe('AC18 coverage meta-assertion (R7)', () => {
    it('AUTHORITY_TABLE covers every declared RefundType', () => {
      const seen = new Set<RefundType>(AUTHORITY_TABLE.map((c) => c.refundType));
      expect([...seen].sort()).toEqual([...REFUND_TYPES_DECLARED].sort());
    });
  });

  // -----------------------------------------------------------------------
  // R8 — load-bearing sentinel block name searchable by future grep.
  // The block documents the invariant: `requireRole` is the COARSE
  // gate; `assertRefundAuthority` is the FINE gate. Future call sites
  // that skip the fine gate on the assumption that the coarse gate is
  // sufficient are the canonical authority-matrix-bypass bug.
  // -----------------------------------------------------------------------
  describe('R8 invariant — requireRole is the COARSE gate; assertRefundAuthority is the FINE gate', () => {
    it('documents that every refund_requests / time_ledger writer MUST call assertRefundAuthority AFTER requireRole', () => {
      // This is a documentation sentinel — the test name is searchable
      // by grep. The body is a tautology so the assertion does not
      // create false test-failure noise.
      expect(true).toBe(true);
    });
  });
});

describe('lib/auth/roleAtLeast — operand direction (R5)', () => {
  // The helper's parameter names are LOAD-BEARING (have, need). Operand
  // swap would collapse owner-only gates to "always allow" at every
  // callsite that inlines `roleAtLeast`. The 2-line direction test
  // catches the swap immediately.
  it('roleAtLeast(owner, manager) === true (actor rank ≥ required rank)', () => {
    expect(roleAtLeast('owner', 'manager')).toBe(true);
  });

  it('roleAtLeast(manager, owner) === false (actor rank < required rank)', () => {
    expect(roleAtLeast('manager', 'owner')).toBe(false);
  });

  it('roleAtLeast(member, member) === true (equal rank passes)', () => {
    expect(roleAtLeast('member', 'member')).toBe(true);
  });

  it('roleAtLeast spans the full ladder', () => {
    // Owner is the ceiling — gates pass for every required role.
    expect(roleAtLeast('owner', 'member')).toBe(true);
    expect(roleAtLeast('owner', 'cashier')).toBe(true);
    expect(roleAtLeast('owner', 'manager')).toBe(true);
    expect(roleAtLeast('owner', 'owner')).toBe(true);

    // Member is the floor — gates fail for everything above.
    expect(roleAtLeast('member', 'cashier')).toBe(false);
    expect(roleAtLeast('member', 'manager')).toBe(false);
    expect(roleAtLeast('member', 'owner')).toBe(false);

    // Cashier passes its own rank, fails manager / owner.
    expect(roleAtLeast('cashier', 'member')).toBe(true);
    expect(roleAtLeast('cashier', 'cashier')).toBe(true);
    expect(roleAtLeast('cashier', 'manager')).toBe(false);
    expect(roleAtLeast('cashier', 'owner')).toBe(false);

    // Manager passes member/cashier/manager; fails owner.
    expect(roleAtLeast('manager', 'member')).toBe(true);
    expect(roleAtLeast('manager', 'cashier')).toBe(true);
    expect(roleAtLeast('manager', 'manager')).toBe(true);
    expect(roleAtLeast('manager', 'owner')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Source-grep sub-tests (R10) — defense-in-depth that the runtime modules
// begin with `import 'server-only';`. Mirrors the AC9.8 pattern in
// tests/audit/with-audit.test.ts.
// ---------------------------------------------------------------------------
describe("source: import 'server-only' present (R10)", () => {
  const ROOT = path.resolve(__dirname, '..', '..');
  const AUTHORITY_FILE = path.join(ROOT, 'lib', 'payments', 'authority.ts');
  const ROLE_AT_LEAST_FILE = path.join(ROOT, 'lib', 'auth', 'roleAtLeast.ts');

  it("lib/payments/authority.ts begins with import 'server-only';", () => {
    const stripped = readFileSync(AUTHORITY_FILE, 'utf8').replace(/^﻿/, '');
    expect(stripped.startsWith("import 'server-only';")).toBe(true);
  });

  it('lib/payments/authority.ts: no other import precedes server-only', () => {
    const content = readFileSync(AUTHORITY_FILE, 'utf8').replace(/^﻿/, '');
    const firstImportMatch = content.match(/^\s*import\s+(?:type\s+)?[^;]+;/m);
    expect(firstImportMatch).not.toBeNull();
    expect(firstImportMatch![0].trim()).toBe("import 'server-only';");
  });

  it("lib/auth/roleAtLeast.ts begins with import 'server-only';", () => {
    const stripped = readFileSync(ROLE_AT_LEAST_FILE, 'utf8').replace(/^﻿/, '');
    expect(stripped.startsWith("import 'server-only';")).toBe(true);
  });
});
