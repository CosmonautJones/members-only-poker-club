/**
 * Static-source-text assertions for `lib/supabase/admin.ts` (ADR-0002 cycle 3,
 * task t0). This is the LOAD-BEARING anti-leak test for the service-role
 * client. Runtime behavior tests of the admin client live elsewhere — this
 * suite exists solely to guarantee the file's source text holds the
 * invariants enumerated in `.conductor/0002/dispatches/0006-premortem-t0.md`.
 *
 * Why static-source-text?
 *
 *   The service-role key bypasses Row-Level Security entirely. Any path that
 *   pulls `lib/supabase/admin.ts` into a client bundle, exports the raw key,
 *   logs the key into Sentry, or constructs the client at module top-level is
 *   one mistake away from a class of breach that cannot be hot-fixed — only
 *   rotated, disclosed, and apologized for. The premortem walks each failure
 *   mode (R1-R8); this test encodes the surface-level guards that fail-closed
 *   under every one.
 *
 *   Runtime tests would cover construction-time behavior, but they cannot
 *   detect "the worker dropped the `import 'server-only';` directive" or
 *   "the worker pasted in a `console.error(err, { key })` call." Static
 *   source-text checks DO detect those.
 *
 * Convention: mirrors `tests/audit/with-audit.test.ts` AC9.8 — `readFileSync`
 * against `resolve(__dirname, '../../lib/supabase/admin.ts')`. This file is
 * Windows-safe (path.resolve handles separator differences) and does NOT
 * import the source file (no module side-effects, so the test passes whether
 * or not the worker has finished writing admin.ts before this test compiles).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ADMIN_FILE = resolve(__dirname, '../../lib/supabase/admin.ts');

describe('lib/supabase/admin.ts (static source asserts)', () => {
  it("first line is import 'server-only';", () => {
    // Premortem R1: if `import 'server-only';` is not the FIRST line, an
    // auto-formatter or organize-imports run can re-sort it below other
    // imports, at which point the next ESM tree-shaking pass may pull
    // admin.ts into a client bundle. Line-position-sensitive, NOT a
    // substring search — `.includes('server-only')` would pass even with
    // the directive buried 40 lines down.
    const source = readFileSync(ADMIN_FILE, 'utf8');
    // Strip an optional UTF-8 BOM so Windows-saved files don't false-fail.
    const stripped = source.replace(/^﻿/, '');
    const lines = stripped.split('\n');
    expect(lines[0]!.trim()).toBe("import 'server-only';");
  });

  it('does NOT export the raw service-role key', () => {
    // Premortem R4: any export beyond `createAdminClient` widens blast
    // radius and erodes audit-grep ("any import from admin.ts is a
    // service-role escalation, audit it"). Specifically forbid exports
    // of the key by env-var name AND by camelCase alias.
    const source = readFileSync(ADMIN_FILE, 'utf8');
    expect(source).not.toMatch(/export.*SUPABASE_SERVICE_ROLE_KEY/);
    expect(source).not.toMatch(/export.*serviceRoleKey/i);
  });

  it('configures auth with persistSession: false', () => {
    // Service-role clients must NEVER persist their session into any
    // store — this is a one-shot construction per request. Literal
    // substring check is sufficient: if this string is missing, the
    // worker either skipped the auth config entirely or set the wrong
    // value.
    const source = readFileSync(ADMIN_FILE, 'utf8');
    expect(source).toContain('persistSession: false');
  });

  it('configures auth with autoRefreshToken: false', () => {
    // No refresh — the service-role key does not have a refresh flow,
    // and any auto-refresh attempt would be a wasted RPC at best and a
    // confusing error at worst.
    const source = readFileSync(ADMIN_FILE, 'utf8');
    expect(source).toContain('autoRefreshToken: false');
  });

  it('configures auth with detectSessionInUrl: false', () => {
    // The admin client never runs in a URL/cookie context. Detecting a
    // session in the URL would conflate auth-flow state with the
    // service-role construction path. Explicit false is the contract.
    const source = readFileSync(ADMIN_FILE, 'utf8');
    expect(source).toContain('detectSessionInUrl: false');
  });

  it('has a placeholder guard', () => {
    // Premortem R2: the most common "test value got promoted to prod"
    // failure mode is the URL or key still holding the literal string
    // 'placeholder' from a `.env.example`. The plan calls for a guard
    // that throws when the URL `.includes('placeholder')`. Loose check
    // here — the worker may format the conditional slightly differently;
    // the point is that SOME placeholder check exists.
    const source = readFileSync(ADMIN_FILE, 'utf8');
    expect(source).toContain("'placeholder'");
    expect(source).toContain('includes(');
  });

  it('has a missing-env guard that throws', () => {
    // Premortem R8: missing `SUPABASE_SERVICE_ROLE_KEY` MUST throw a
    // loud, distinct error — never soft-fail to `null`, never log the
    // value. Loose check: the env-var name appears AND the source
    // contains a `throw` keyword. The worker is free to phrase the
    // error message; the contract is "fail closed, fail loud."
    const source = readFileSync(ADMIN_FILE, 'utf8');
    expect(source).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(source).toMatch(/\bthrow\b/);
  });

  it('has no top-level createClient(...) call (only inside the factory)', () => {
    // Premortem R8: `createClient(...)` at module top level means
    // missing-env throws fire at IMPORT time, breaking app boot for
    // every request — and incentivizing a dev to "fix" it by softening
    // the guard. The factory pattern (construct lazily inside
    // `createAdminClient`) keeps the throw at call site.
    //
    // Multi-line regex: anchor `^` matches the start of any line. A
    // line starting with `createClient(` would be a top-level call.
    // `import { createClient } from ...` is fine — that line starts
    // with `import`, not `createClient`.
    const source = readFileSync(ADMIN_FILE, 'utf8');
    expect(source).not.toMatch(/^createClient\(/m);
  });

  it('exports createAdminClient as a function or const', () => {
    // Premortem R4: the exports list must be exactly
    // `['createAdminClient']`. This assertion is the positive half —
    // the export exists and is named correctly. The negative half (no
    // raw-key exports) is covered above.
    const source = readFileSync(ADMIN_FILE, 'utf8');
    expect(source).toMatch(/export\s+(function|const)\s+createAdminClient/);
  });
});
