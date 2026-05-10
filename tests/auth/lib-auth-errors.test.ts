/**
 * Static-source-text assertions for `lib/auth/errors.ts` (ADR-0002 cycle 3, t1).
 *
 * Run locally:    pnpm test tests/auth/lib-auth-errors.test.ts
 * Prerequisites:  none — pure readFileSync, no module load.
 *
 * Spec AC7 + critic concern C1: `lib/auth/errors.ts` MUST start with
 * `import 'server-only';` as line 1. The directive is load-bearing — it
 * trips Next's compiler if the module is ever pulled into a client bundle,
 * defending the privilege-error class names ("InsufficientRoleError" and
 * its `required`/`actual` fields) from leaking into the browser.
 *
 * Convention mirrors `tests/auth/lib-supabase-admin.test.ts` (the cycle-3
 * t0 anti-leak test): `readFileSync` against `resolve(__dirname,
 * '../../lib/auth/errors.ts')`, line-position-sensitive, BOM-stripped.
 *
 * Why static-source-text? Runtime tests cannot detect "the worker dropped
 * the `import 'server-only';` directive" or "an auto-formatter sorted the
 * imports and pushed `'server-only'` below an alphabetical neighbor."
 * Static checks DO.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ERRORS_FILE = resolve(__dirname, '../../lib/auth/errors.ts');

describe('lib/auth/errors.ts (static source asserts)', () => {
  it("first line is import 'server-only';", () => {
    // If `import 'server-only';` is not the FIRST line, an auto-formatter
    // or organize-imports run can re-sort it below other imports, at which
    // point the next ESM tree-shaking pass may pull errors.ts into a
    // client bundle. Line-position-sensitive — a substring search would
    // pass even with the directive buried 40 lines down, so we anchor on
    // line 0.
    const source = readFileSync(ERRORS_FILE, 'utf8');
    // Strip an optional UTF-8 BOM so Windows-saved files don't false-fail.
    const stripped = source.replace(/^﻿/, '');
    const lines = stripped.split('\n');
    expect(lines[0]!.trim()).toBe("import 'server-only';");
  });

  it('exports InsufficientRoleError class', () => {
    // Positive guard for the contract — the class exists by name. The
    // negative half (no other exports leak privileged data) is implicit:
    // the file is small enough that any drift surfaces in code review.
    const source = readFileSync(ERRORS_FILE, 'utf8');
    expect(source).toMatch(/export\s+class\s+InsufficientRoleError/);
  });
});
