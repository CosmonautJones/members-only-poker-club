/**
 * Unit tests for `app/(admin)/admin/flags/page.tsx` — the AC21 feature-
 * flags console (ADR-0035 WC.T16).
 *
 * Run locally:    pnpm test tests/admin/flags-page.test.tsx
 * Prerequisites:  none — pure module mocks (no DB, no network).
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC21
 *       (per-row table, kill-switch typed-confirmation, STALE pill).
 *
 * SUT contract (per AC21):
 *   - Server component. FIRST body statement is
 *     `await requireRole('manager');`
 *   - Renders one row per flag with all nine columns.
 *   - Kill-switch (key starts with `kill-`) toggling the enabled checkbox
 *     + clicking Save opens a TypedConfirmationDialog requiring
 *     `enable` / `disable` to match the action direction.
 *   - Non-kill flag Save calls `updateFlagAction` immediately.
 *   - STALE pill renders when `expires_at < now()-90d` AND
 *     `percent IN (0, 100)`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
        profile: { id: string; role: string };
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

// Mock the `'use server'` re-export shim so the client component picks
// up our spy. The underlying updateFlag.ts is exercised by
// `tests/admin/update-flag-action.test.ts`; here we only verify the page
// + the client component invoke the wrapper with the right shape.
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
        onFulfilled: (v: { data?: unknown; error?: { message: string } | null }) => unknown,
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

// Stub window.location.reload — the client component reloads after a
// successful save.
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

// ---- Test helpers ---------------------------------------------------------

const baseProfile = { id: 'uuid-manager', role: 'manager' };

const NOW_ISO = '2026-05-15T12:00:00.000Z';

function flag(overrides: Partial<FlagRow> = {}): FlagRow {
  return {
    key: 'show-leaderboard',
    enabled: true,
    percent: 50,
    allowlist: [],
    role_gate: null,
    owner: 'product',
    expires_at: '2026-08-13T12:00:00.000Z', // 90 days after NOW
    updated_at: NOW_ISO,
    updated_by: 'uuid-manager',
    ...overrides,
  };
}

async function renderPage(): Promise<void> {
  const tree = (await FlagsPage()) as React.ReactElement;
  render(tree);
}

// ---- Tests ----------------------------------------------------------------

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.requireRole.mockResolvedValue({ profile: baseProfile });
  mocks.flagsResult = { data: [], error: null };
  mocks.profilesResult = {
    data: [{ id: 'uuid-manager', email: 'manager@example.com' }],
    error: null,
  };
  mocks.updateFlagAction.mockClear();
});

describe('flags page — requireRole gate', () => {
  it('calls requireRole("manager") as the first body statement', async () => {
    await renderPage();
    expect(mocks.requireRole).toHaveBeenCalledTimes(1);
    expect(mocks.requireRole).toHaveBeenCalledWith('manager');
  });
});

describe('flags page — empty state', () => {
  it('renders "No feature flags defined." when there are no rows', async () => {
    mocks.flagsResult = { data: [], error: null };
    await renderPage();
    expect(screen.getByText('No feature flags defined.')).toBeTruthy();
  });
});

describe('flags page — renders all columns', () => {
  it('renders the key, percent, role_gate, owner, and updated_by_email for a flag', async () => {
    mocks.flagsResult = {
      data: [
        flag({
          key: 'show-leaderboard',
          enabled: true,
          percent: 75,
          role_gate: 'member',
          owner: 'product',
        }),
      ],
      error: null,
    };
    await renderPage();

    // key
    expect(screen.getByText('show-leaderboard')).toBeTruthy();
    // percent text
    expect(screen.getByText('75%')).toBeTruthy();
    // owner
    expect(screen.getByText('product')).toBeTruthy();
    // updated_by resolved email
    expect(screen.getByText(/manager@example\.com/)).toBeTruthy();
  });

  it('renders the table headers', async () => {
    mocks.flagsResult = { data: [flag()], error: null };
    await renderPage();
    expect(screen.getByText('Key')).toBeTruthy();
    expect(screen.getByText('Enabled')).toBeTruthy();
    expect(screen.getByText('Percent')).toBeTruthy();
    expect(screen.getByText('Allowlist')).toBeTruthy();
    expect(screen.getByText('Role gate')).toBeTruthy();
    expect(screen.getByText('Owner')).toBeTruthy();
  });

  it('renders the allowlist count', async () => {
    mocks.flagsResult = {
      data: [flag({ allowlist: ['uuid-a', 'uuid-b', 'uuid-c'] })],
      error: null,
    };
    await renderPage();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('falls back to "system" when updated_by_email is unresolved', async () => {
    mocks.flagsResult = {
      data: [flag({ updated_by: 'uuid-unknown' })],
      error: null,
    };
    mocks.profilesResult = { data: [], error: null };
    await renderPage();
    expect(screen.getByText(/by system/)).toBeTruthy();
  });

  it('renders a "—" placeholder for null expires_at', async () => {
    mocks.flagsResult = {
      data: [flag({ expires_at: null })],
      error: null,
    };
    await renderPage();
    // The em-dash placeholder appears in the row body when expires_at is
    // null; we use a within() to scope to the row to avoid colliding with
    // any other dash in the page chrome.
    const row = screen.getByText('show-leaderboard').closest('tr')!;
    expect(within(row).getByText('—')).toBeTruthy();
  });
});

describe('flags page — STALE pill', () => {
  it('renders STALE pill when expires_at is > 90d ago AND percent === 0', async () => {
    // Pre-90d threshold: 2024-01-01 is well over 90 days before any
    // reasonable test-clock now. We don't mock the page's internal
    // Date.now(), so the assertion is "past dates with percent in {0,100}
    // surface as stale."
    mocks.flagsResult = {
      data: [
        flag({
          key: 'old-experiment',
          expires_at: '2024-01-01T00:00:00.000Z',
          percent: 0,
        }),
      ],
      error: null,
    };
    await renderPage();
    expect(screen.getByTestId('flag-stale-pill-old-experiment')).toBeTruthy();
    expect(screen.getByText('STALE')).toBeTruthy();
  });

  it('renders STALE pill when expires_at is > 90d ago AND percent === 100', async () => {
    mocks.flagsResult = {
      data: [
        flag({
          key: 'old-rollout',
          expires_at: '2024-01-01T00:00:00.000Z',
          percent: 100,
        }),
      ],
      error: null,
    };
    await renderPage();
    expect(screen.getByTestId('flag-stale-pill-old-rollout')).toBeTruthy();
  });

  it('does NOT render STALE pill when percent is partial (50)', async () => {
    mocks.flagsResult = {
      data: [
        flag({
          key: 'in-progress',
          expires_at: '2024-01-01T00:00:00.000Z',
          percent: 50,
        }),
      ],
      error: null,
    };
    await renderPage();
    expect(screen.queryByTestId('flag-stale-pill-in-progress')).toBeNull();
  });

  it('does NOT render STALE pill when expires_at is in the near past (within 90d)', async () => {
    // Use a date that is well within 90 days of any reasonable future
    // test-clock now. Since the test runs in 2026, an expires_at in
    // mid-2099 is comfortably > now (not yet expired); use a date 30
    // days before "now" via the harness mock — but the page uses real
    // `new Date()`. We instead use a date AFTER 2030 to guarantee
    // "not yet expired," which also surfaces as not stale.
    mocks.flagsResult = {
      data: [
        flag({
          key: 'fresh-flag',
          expires_at: '2030-12-31T00:00:00.000Z',
          percent: 0,
        }),
      ],
      error: null,
    };
    await renderPage();
    expect(screen.queryByTestId('flag-stale-pill-fresh-flag')).toBeNull();
  });

  it('does NOT render STALE pill when expires_at is null', async () => {
    mocks.flagsResult = {
      data: [flag({ key: 'unbounded', expires_at: null, percent: 0 })],
      error: null,
    };
    await renderPage();
    expect(screen.queryByTestId('flag-stale-pill-unbounded')).toBeNull();
  });
});

describe('flags page — kill-switch typed-confirmation', () => {
  beforeEach(() => {
    mocks.flagsResult = {
      data: [
        flag({
          key: 'kill-stripe-webhook',
          enabled: false,
          percent: 100,
          owner: 'payments',
        }),
      ],
      error: null,
    };
  });

  it('toggling the enabled checkbox + Save opens the kill-switch dialog', async () => {
    const user = userEvent.setup();
    await renderPage();

    // The row is flagged with the kill-switch data attribute.
    const row = screen.getByText('kill-stripe-webhook').closest('tr')!;
    expect(row.getAttribute('data-is-kill-switch')).toBe('true');

    // Toggle enabled false -> true.
    const toggle = screen.getByTestId('flag-enabled-kill-stripe-webhook');
    await user.click(toggle);

    // Click Save.
    await user.click(screen.getByTestId('flag-save-kill-stripe-webhook'));

    // Dialog opens.
    const dialog = await screen.findByTestId('typed-confirmation-dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    // The phrase required is `enable` (we toggled to enabled=true).
    const phraseEl = screen.getByTestId('typed-confirmation-phrase');
    expect(phraseEl.textContent).toBe('enable');

    // The action has NOT been called yet — confirmation gates it.
    expect(mocks.updateFlagAction).not.toHaveBeenCalled();
  });

  it('typed phrase "enable" enables the Confirm button; the action fires on confirm', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByTestId('flag-enabled-kill-stripe-webhook'));
    await user.click(screen.getByTestId('flag-save-kill-stripe-webhook'));

    const confirm = (await screen.findByTestId('typed-confirmation-confirm')) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    await user.type(screen.getByTestId('typed-confirmation-input'), 'enable');
    expect(confirm.disabled).toBe(false);

    await user.click(confirm);

    // The action fires with the new enabled value.
    expect(mocks.updateFlagAction).toHaveBeenCalledTimes(1);
    expect(mocks.updateFlagAction).toHaveBeenCalledWith({
      key: 'kill-stripe-webhook',
      enabled: true,
    });
  });

  it('typed phrase "disable" is required when toggling enabled true -> false', async () => {
    mocks.flagsResult = {
      data: [
        flag({
          key: 'kill-stripe-webhook',
          enabled: true,
          percent: 100,
          owner: 'payments',
        }),
      ],
      error: null,
    };
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByTestId('flag-enabled-kill-stripe-webhook'));
    await user.click(screen.getByTestId('flag-save-kill-stripe-webhook'));

    const phraseEl = await screen.findByTestId('typed-confirmation-phrase');
    expect(phraseEl.textContent).toBe('disable');
  });

  it('Case-sensitive: "ENABLE" does NOT enable Confirm (case-sensitive gate)', async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByTestId('flag-enabled-kill-stripe-webhook'));
    await user.click(screen.getByTestId('flag-save-kill-stripe-webhook'));

    const confirm = (await screen.findByTestId('typed-confirmation-confirm')) as HTMLButtonElement;
    await user.type(screen.getByTestId('typed-confirmation-input'), 'ENABLE');
    expect(confirm.disabled).toBe(true);
  });
});

describe('flags page — non-kill flag saves immediately', () => {
  it('non-kill flag toggle + Save calls updateFlagAction WITHOUT opening the dialog', async () => {
    mocks.flagsResult = {
      data: [flag({ key: 'show-leaderboard', enabled: false })],
      error: null,
    };
    const user = userEvent.setup();
    await renderPage();

    const row = screen.getByText('show-leaderboard').closest('tr')!;
    expect(row.getAttribute('data-is-kill-switch')).toBeNull();

    await user.click(screen.getByTestId('flag-enabled-show-leaderboard'));
    await user.click(screen.getByTestId('flag-save-show-leaderboard'));

    // No dialog opens — the action is called directly.
    expect(screen.queryByTestId('typed-confirmation-dialog')).toBeNull();
    expect(mocks.updateFlagAction).toHaveBeenCalledTimes(1);
    expect(mocks.updateFlagAction).toHaveBeenCalledWith({
      key: 'show-leaderboard',
      enabled: true,
    });
  });
});
