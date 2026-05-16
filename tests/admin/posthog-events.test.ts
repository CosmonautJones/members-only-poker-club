/**
 * Cross-cutting tests for the admin-console PostHog event wiring
 * (ADR-0035 AC31, WD.T21 / t18, premortem R4).
 *
 * Run locally:    pnpm test tests/admin/posthog-events.test.ts
 * Prerequisites:  none — pure source-text scan (Part 1) + in-process
 *                 unit tests via mocked driver (Part 2). No DB, no
 *                 network.
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC31.
 *
 * Two parts:
 *
 *   1. Source-grep wiring assertions — every admin mutation action
 *      contains a `trackAdminEvent(...)` call site, AND every admin
 *      action source file is free of forbidden-key tokens in PostHog
 *      payloads (premortem R4 grep).
 *
 *   2. Runtime behavior — drive the `trackAdminEvent` helper through
 *      consent gates, R4 PII-key stripping, and the silent-error
 *      catch-all.
 *
 * Why two layers: the source-grep catches a future caller that hand-
 * builds a property object with a forbidden key (the helper's strip
 * would silently drop it), AND the runtime test pins the consent gate
 * + strip behavior so a future refactor of the helper cannot regress
 * the load-bearing R4 contract.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Neutralise the server-only guard so vitest can import the helper
// under happy-dom. Mirrors the pattern in tests/audit/with-audit.test.ts.
vi.mock('server-only', () => ({}));

// ---- Path resolution (Windows-safe) ---------------------------------------

const __filename =
  typeof __dirname === 'undefined'
    ? fileURLToPath(import.meta.url)
    : `${__dirname}/__placeholder__`;
const TEST_DIR = typeof __dirname === 'undefined' ? dirname(__filename) : __dirname;
const ADMIN_ROOT = resolve(TEST_DIR, '..', '..', 'app', '(admin)', 'admin');

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

// ---- Part 1: source-grep wiring assertions -------------------------------

/**
 * The mutation-class action files that MUST emit a `trackAdminEvent`
 * call. Read-only actions (searchMembers, queryAuditLog) and the
 * barrel `index.ts` re-exports are excluded.
 */
const MUTATION_ACTION_FILES: ReadonlyArray<string> = [
  'verifications/_actions/approveVerification.ts',
  'verifications/_actions/rejectVerification.ts',
  'verifications/_actions/requestVerificationInfo.ts',
  'members/[id]/_actions/changeRole.ts',
  'members/[id]/_actions/requestReverification.ts',
  'members/[id]/_actions/initiateMemberDeletion.ts',
  'members/[id]/_actions/openRefundFlow.ts',
  'flags/_actions/updateFlag.ts',
  'privacy/_actions/approveExport.ts',
  'privacy/_actions/approveDeletion.ts',
  'privacy/_actions/rejectRequest.ts',
];

describe('admin PostHog wiring / source-grep', () => {
  it('every mutation-class admin action contains a trackAdminEvent call', () => {
    const missing: string[] = [];
    for (const rel of MUTATION_ACTION_FILES) {
      const abs = join(ADMIN_ROOT, ...rel.split('/'));
      const source = readFileSync(abs, 'utf-8');
      if (!/\btrackAdminEvent\s*\(/.test(source)) {
        missing.push(rel);
      }
    }
    expect(missing).toEqual([]);
  });

  it('admin layout emits admin_session_entered', () => {
    const layoutPath = resolve(ADMIN_ROOT, 'layout.tsx');
    const source = readFileSync(layoutPath, 'utf-8');
    expect(source).toMatch(/trackAdminEvent\(\s*['"]admin_session_entered['"]/);
  });

  it('no admin action source file passes a forbidden-key property to trackAdminEvent (premortem R4)', () => {
    // Extract every trackAdminEvent({...}) call's property bag and assert
    // no key name matches the R4 forbidden regex. This is a defense in
    // depth — the helper itself strips forbidden keys, but a future
    // refactor that pulls a payload literal out of an inline call site
    // could leak intent that the silent strip then conceals.
    const FORBIDDEN_KEY_RE = /\b(email|profile_id|actor_id|target_id|user_id)\s*:/;
    const files = collectActionFiles(ADMIN_ROOT);
    const offenders: { file: string; snippet: string }[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      const callRe = /trackAdminEvent\s*\(\s*['"][^'"]+['"]\s*,\s*\{([\s\S]*?)\}\s*\)/g;
      let match: RegExpExecArray | null;
      while ((match = callRe.exec(source)) !== null) {
        const body = match[1]!;
        const m = FORBIDDEN_KEY_RE.exec(body);
        if (m) {
          offenders.push({
            file: file.replace(/\\/g, '/'),
            snippet: body.slice(Math.max(0, m.index - 16), m.index + 32).trim(),
          });
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---- Part 2: runtime behavior --------------------------------------------

// State injected from the next/headers cookie mock — each test programs
// the consent cookie value it needs.
const headersMockState = vi.hoisted(() => ({
  consentCookieValue: null as string | null,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      if (name === 'mopc-consent' && headersMockState.consentCookieValue !== null) {
        return { name, value: headersMockState.consentCookieValue };
      }
      return undefined;
    },
  }),
}));

// Capture every `driver.capture(...)` call so the test can introspect
// what would have been sent to PostHog.
const driverMockState = vi.hoisted(() => ({
  events: [] as Array<{ name: string; props: Record<string, unknown> }>,
}));

vi.mock('@/lib/analytics/driver', () => ({
  getDriver: () => ({
    capture: (event: { name: string; props: Record<string, unknown> }) => {
      driverMockState.events.push(event);
    },
    identify: () => {
      /* not exercised here */
    },
  }),
}));

function setConsent(state: { analytics: boolean } | null): void {
  if (state === null) {
    headersMockState.consentCookieValue = null;
    return;
  }
  headersMockState.consentCookieValue = JSON.stringify({
    essential: true,
    analytics: state.analytics,
    errors: false,
    version: 1,
  });
}

beforeEach(() => {
  driverMockState.events.length = 0;
  headersMockState.consentCookieValue = null;
});

describe('trackAdminEvent / consent gate', () => {
  it('drops the event when no consent cookie is set', async () => {
    const { trackAdminEvent } = await import('@/lib/analytics/admin-events');
    await trackAdminEvent('admin_action_attempted', {
      action: 'approveVerification',
      target_type: 'profile',
      outcome: 'ok',
    });
    expect(driverMockState.events).toHaveLength(0);
  });

  it('drops the event when analytics consent is false', async () => {
    setConsent({ analytics: false });
    const { trackAdminEvent } = await import('@/lib/analytics/admin-events');
    await trackAdminEvent('admin_action_attempted', {
      action: 'approveVerification',
      target_type: 'profile',
      outcome: 'ok',
    });
    expect(driverMockState.events).toHaveLength(0);
  });

  it('forwards the event when analytics consent is true', async () => {
    setConsent({ analytics: true });
    const { trackAdminEvent } = await import('@/lib/analytics/admin-events');
    await trackAdminEvent('admin_action_attempted', {
      action: 'approveVerification',
      target_type: 'profile',
      outcome: 'ok',
    });
    expect(driverMockState.events).toHaveLength(1);
    const first = driverMockState.events[0]!;
    expect(first.name).toBe('admin_action_attempted');
    expect(first.props).toEqual({
      action: 'approveVerification',
      target_type: 'profile',
      outcome: 'ok',
    });
  });
});

describe('trackAdminEvent / premortem R4 PII guard', () => {
  it('strips every forbidden key from the payload before forwarding', async () => {
    setConsent({ analytics: true });
    const { trackAdminEvent } = await import('@/lib/analytics/admin-events');
    await trackAdminEvent('admin_action_attempted', {
      action: 'changeRole',
      target_type: 'profile',
      outcome: 'ok',
      // EVERY forbidden key shape — case + position variations.
      email: 'leak@example.com',
      profile_id: 'leak-profile',
      actor_id: 'leak-actor',
      target_id: 'leak-target',
      user_id: 'leak-user',
      member_email: 'leak2@example.com', // contains 'email' substring
      Profile_ID: 'leak-cased',
      // Allowed keys — should survive.
      role: 'manager',
    });
    expect(driverMockState.events).toHaveLength(1);
    const first = driverMockState.events[0]!;
    const keys = Object.keys(first.props);
    const FORBIDDEN_KEY_RE = /email|profile_id|actor_id|target_id|user_id/i;
    for (const k of keys) {
      expect(FORBIDDEN_KEY_RE.test(k), `key ${k} matched forbidden regex`).toBe(false);
    }
    expect(first.props).toEqual({
      action: 'changeRole',
      target_type: 'profile',
      outcome: 'ok',
      role: 'manager',
    });
  });

  it('every recorded event has zero forbidden-key matches across all four event names', async () => {
    setConsent({ analytics: true });
    const { trackAdminEvent } = await import('@/lib/analytics/admin-events');
    // Drive every event-name variant the wiring uses, with at least one
    // forbidden key in each payload — the helper MUST strip it.
    await trackAdminEvent('admin_session_entered', {
      role: 'manager',
      outcome: 'ok',
      actor_id: 'should-be-stripped',
    });
    await trackAdminEvent('admin_action_attempted', {
      action: 'rejectVerification',
      target_type: 'profile',
      outcome: 'ok',
      target_id: 'should-be-stripped',
    });
    await trackAdminEvent('admin_verification_decision', {
      decision: 'approve',
      queue_depth_at_decision: 3,
      profile_id: 'should-be-stripped',
    });
    await trackAdminEvent('admin_flag_changed', {
      flag_key: 'features.demo',
      field: 'enabled',
      email: 'should-be-stripped',
    });
    expect(driverMockState.events).toHaveLength(4);
    const FORBIDDEN_KEY_RE = /email|profile_id|actor_id|target_id|user_id/i;
    for (const ev of driverMockState.events) {
      for (const k of Object.keys(ev.props)) {
        expect(FORBIDDEN_KEY_RE.test(k), `event ${ev.name} retained forbidden key ${k}`).toBe(
          false,
        );
      }
    }
  });
});

describe('trackAdminEvent / error swallow', () => {
  it('does not throw when the consent cookie payload is malformed', async () => {
    // Set a non-JSON cookie value — `readServerConsent` should treat it
    // as null (no consent) and the helper drops silently.
    headersMockState.consentCookieValue = 'not-json-at-all';
    const { trackAdminEvent } = await import('@/lib/analytics/admin-events');
    await expect(
      trackAdminEvent('admin_action_attempted', { action: 'x', outcome: 'ok' }),
    ).resolves.toBeUndefined();
    expect(driverMockState.events).toHaveLength(0);
  });

  it('does not throw when the consent cookie has wrong version', async () => {
    // Version mismatch — schema bumped, old cookie treated as missing.
    headersMockState.consentCookieValue = JSON.stringify({
      essential: true,
      analytics: true,
      errors: true,
      version: 999,
    });
    const { trackAdminEvent } = await import('@/lib/analytics/admin-events');
    await trackAdminEvent('admin_action_attempted', { action: 'x', outcome: 'ok' });
    expect(driverMockState.events).toHaveLength(0);
  });
});
