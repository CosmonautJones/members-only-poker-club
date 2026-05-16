/**
 * Tests for `lib/payments/console-availability.ts` — ADR-0036 Slice 1,
 * t12, AC29.
 *
 * Run locally:    pnpm test tests/payments/console-availability.test.ts
 * Prerequisites:  none — pure module read + source-grep.
 *
 * Spec: docs/specs/0036-payment-management-console-implementation.md AC29.
 * Module under test: lib/payments/console-availability.ts (single
 *   exported boolean constant + load-bearing `import 'server-only';`).
 *
 * Contract (per AC29):
 *   - `PAYMENTS_CONSOLE_READY === true` (post-ADR-0036 v1 flip).
 *   - File's first line is `import 'server-only';`.
 *   - JSDoc references "ADR-0036 v1" to document the flip.
 *
 * The historical degraded-redirect branch is covered by the AC17.1
 * sub-case in `tests/admin/open-refund-flow-action.test.ts` via a
 * file-level `vi.mock` override; the AC30 sub-case in the same file
 * documents that the override is the only thing keeping the degraded
 * branch under test (remove the override → canonical redirect).
 *
 * Why server-only matters: this constant gates an admin server action's
 * redirect target. If it ever leaked into a client bundle the bundler
 * could DCE-eliminate the production check and the refund flow would
 * become un-testable at runtime. `import 'server-only';` is the
 * compile-time enforcement.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// `server-only` is a guard re-export — neutralize so the SUT import
// succeeds under the vitest runtime (standard repo pattern).
vi.mock('server-only', () => ({}));

// eslint-disable-next-line import/first
import { PAYMENTS_CONSOLE_READY } from '@/lib/payments/console-availability';

const __filename =
  typeof __dirname === 'undefined'
    ? fileURLToPath(import.meta.url)
    : `${__dirname}/__placeholder__`;
const TEST_DIR = typeof __dirname === 'undefined' ? dirname(__filename) : __dirname;
const SUT_PATH = resolve(TEST_DIR, '..', '..', 'lib', 'payments', 'console-availability.ts');

describe('PAYMENTS_CONSOLE_READY — runtime value (AC29)', () => {
  it('is exactly `true` (post-ADR-0036 v1 flip)', () => {
    expect(PAYMENTS_CONSOLE_READY).toBe(true);
  });

  it('is a boolean type (not truthy-coerced from another value)', () => {
    expect(typeof PAYMENTS_CONSOLE_READY).toBe('boolean');
  });
});

describe('lib/payments/console-availability.ts — source-shape invariants (AC29)', () => {
  it("first line is `import 'server-only';` (load-bearing — must not leak to client bundle)", () => {
    // Strip a UTF-8 BOM if present so the comparison is exact.
    const src = readFileSync(SUT_PATH, 'utf8').replace(/^﻿/, '');
    const firstLine = src.split(/\r?\n/)[0]!.trim();
    expect(firstLine).toBe("import 'server-only';");
  });

  it('JSDoc records the ADR-0036 v1 flip (cite "ADR-0036 v1")', () => {
    const src = readFileSync(SUT_PATH, 'utf8');
    expect(src).toMatch(/ADR-0036 v1/);
  });

  it('exports the constant with the literal value `true` (source-grep)', () => {
    // A vigilant source-grep catches a refactor that silently reverts
    // the flip by typing the constant as `boolean = false` again.
    const src = readFileSync(SUT_PATH, 'utf8');
    expect(src).toMatch(/export\s+const\s+PAYMENTS_CONSOLE_READY\s*:\s*boolean\s*=\s*true\s*;/);
    expect(src).not.toMatch(
      /export\s+const\s+PAYMENTS_CONSOLE_READY\s*:\s*boolean\s*=\s*false\s*;/,
    );
  });
});
