/**
 * axe-core a11y sweep for `app/(admin)/admin/flags/page.tsx` —
 * ADR-0035 AC33 / WD.T23 (t20).
 *
 * Mock plumbing mirrors `tests/admin/flags-page.test.tsx`.
 */

import { describe, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

import { expectNoSeriousAxeViolations, BASE_MANAGER_PROFILE } from './_helpers';

// ---- Hoisted mock primitives ----------------------------------------------

type FlagRow = {
  key: string;
  enabled: boolean;
  percent: number;
  allowlist: string[];
  role_gate: string | null;
  owner: string;
  expires_at: string | null;
  updated_at: string;
  updated_by: string | null;
};

type MockShape = {
  requireRole: ReturnType<
    typeof vi.fn<
      (required: string) => Promise<{
        profile: { id: string; role: string; full_name: string; email: string };
      }>
    >
  >;
  flagsResult: { data: FlagRow[]; error: { message: string } | null };
  profilesResult: { data: Array<{ id: string; email: string }>; error: { message: string } | null };
  updateFlagAction: ReturnType<typeof vi.fn>;
};

const mocks: MockShape = vi.hoisted(
  (): MockShape => ({
    requireRole: vi.fn(),
    flagsResult: { data: [], error: null },
    profilesResult: { data: [], error: null },
    updateFlagAction: vi.fn(async () => ({ ok: true as const })),
  }),
);

// ---- Mocks ----------------------------------------------------------------

vi.mock('server-only', () => ({}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((p: string) => {
    const e = new Error(`NEXT_REDIRECT: ${p}`);
    (e as Error & { digest?: string }).digest = `NEXT_REDIRECT;${p}`;
    throw e;
  }),
}));

vi.mock('@/lib/auth/requireRole', () => ({
  requireRole: mocks.requireRole,
}));

vi.mock('@/app/(admin)/admin/flags/_actions', () => ({
  updateFlagAction: mocks.updateFlagAction,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => {
    function makeChain(table: string) {
      const chain: Record<string, unknown> = {};
      const passthrough = () => chain;
      for (const m of ['select', 'order', 'eq', 'in', 'is', 'not', 'like', 'limit', 'range']) {
        chain[m] = passthrough;
      }
      chain['then'] = (
        onFulfilled: (v: {
          data?: unknown;
          error?: { message: string } | null;
        }) => unknown,
      ) => {
        const result = table === 'feature_flags' ? mocks.flagsResult : mocks.profilesResult;
        return Promise.resolve(result).then(onFulfilled);
      };
      return chain;
    }
    return {
      from: (table: string) => makeChain(table),
    };
  },
}));

// Stub window.location.reload — the FlagRow client component reloads
// after a successful save; the stub keeps happy-dom from crashing if
// axe's keyboard-handler emulation trips the handler.
const reloadSpy = vi.hoisted(() => vi.fn());
beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload: reloadSpy },
  });
  reloadSpy.mockClear();
});

// ---- Import AFTER mocks ---------------------------------------------------

// eslint-disable-next-line import/first
import FlagsPage from '@/app/(admin)/admin/flags/page';

// ---- Fixtures -------------------------------------------------------------

const NOW_ISO = '2026-05-15T12:00:00.000Z';

function flag(overrides: Partial<FlagRow> = {}): FlagRow {
  return {
    key: 'show-leaderboard',
    enabled: true,
    percent: 50,
    allowlist: [],
    role_gate: null,
    owner: 'product',
    expires_at: '2026-08-13T12:00:00.000Z',
    updated_at: NOW_ISO,
    updated_by: BASE_MANAGER_PROFILE.id,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.requireRole.mockResolvedValue({ profile: BASE_MANAGER_PROFILE });
  mocks.flagsResult = { data: [], error: null };
  mocks.profilesResult = {
    data: [{ id: BASE_MANAGER_PROFILE.id, email: BASE_MANAGER_PROFILE.email }],
    error: null,
  };
  mocks.updateFlagAction.mockClear();
});

async function renderPage(): Promise<HTMLElement> {
  const tree = (await FlagsPage()) as React.ReactElement;
  const { container } = render(tree);
  return container;
}

// ---- Tests ----------------------------------------------------------------

describe('admin flags — axe-core a11y (AC33)', () => {
  it('has no serious or critical axe violations with rows present', async () => {
    mocks.flagsResult = {
      data: [
        flag({
          key: 'show-leaderboard',
          enabled: true,
          percent: 75,
          role_gate: 'member',
          allowlist: ['uuid-a', 'uuid-b'],
        }),
        flag({
          key: 'kill-payments',
          enabled: false,
          percent: 0,
          role_gate: null,
          owner: 'payments',
          expires_at: '2024-01-01T00:00:00.000Z', // > 90d ago → STALE pill
        }),
      ],
      error: null,
    };
    const container = await renderPage();
    await expectNoSeriousAxeViolations(container);
  });

  it('has no serious or critical axe violations in the empty-state branch', async () => {
    mocks.flagsResult = { data: [], error: null };
    const container = await renderPage();
    await expectNoSeriousAxeViolations(container);
  });

  it('has no serious or critical axe violations when updated_by resolution fails', async () => {
    mocks.flagsResult = { data: [flag({ updated_by: 'uuid-unknown' })], error: null };
    mocks.profilesResult = { data: [], error: null };
    const container = await renderPage();
    await expectNoSeriousAxeViolations(container);
  });
});
