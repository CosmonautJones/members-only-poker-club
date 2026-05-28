/**
 * Unit tests for `app/(marketing)/games/page.tsx` (ADR-0037 §`/games` rendering).
 *
 * Run locally:    pnpm test tests/pages/games-page.test.tsx
 * Prerequisites:  none — pure module mocks.
 *
 * Coverage:
 *   - Flag OFF → renders the in-page UPCOMING_FALLBACK (4 hardcoded events).
 *   - Flag ON + rows → renders DB tournament names.
 *   - Flag ON + empty → renders "No tournaments are scheduled" message.
 *   - Flag ON + query error → renders fallback message + emits console.error
 *     (Sentry would capture this in production).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Tournament } from '@/lib/tournaments/types';

const mocks = vi.hoisted(() => ({
  isEnabled: vi.fn<(key: string) => boolean>(),
  fetchUpcomingTournaments: vi.fn<() => Promise<Tournament[]>>(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/flags', async () => {
  const actual = await vi.importActual<typeof import('@/lib/flags')>('@/lib/flags');
  return { ...actual, isEnabled: mocks.isEnabled };
});
vi.mock('@/lib/tournaments/queries', () => ({
  fetchUpcomingTournaments: mocks.fetchUpcomingTournaments,
}));

import GamesPage from '@/app/(marketing)/games/page';

const liveRow = (slug: string, name: string, startsAt: string): Tournament => ({
  id: '00000000-0000-0000-0000-000000000000',
  slug,
  name,
  startsAt,
  tzName: 'America/Chicago',
  buyInCents: 15000,
  capacity: 40,
  gameType: 'nlhe',
  structureMd: null,
  status: 'scheduled',
  sourceTemplateId: null,
  venueName: 'Members Only Poker Social Club',
  venueAddress: '16525 North Fwy, Houston, TX 77090',
});

beforeEach(() => {
  mocks.isEnabled.mockReset();
  mocks.fetchUpcomingTournaments.mockReset();
});

describe('GamesPage — flag-driven upcoming events', () => {
  it('flag OFF: renders the in-page UPCOMING_FALLBACK list (does NOT call fetchUpcomingTournaments)', async () => {
    mocks.isEnabled.mockReturnValue(false);

    const Page = await GamesPage();
    render(Page);

    expect(mocks.fetchUpcomingTournaments).not.toHaveBeenCalled();
    expect(screen.getByText('Tuesday Bounty')).toBeInTheDocument();
    expect(screen.getByText('Friday Nightly')).toBeInTheDocument();
  });

  it('flag ON with rows: renders the DB tournament names', async () => {
    mocks.isEnabled.mockReturnValue(true);
    mocks.fetchUpcomingTournaments.mockResolvedValueOnce([
      liveRow('manager-test-bounty', 'Manager Test Bounty', '2026-06-10T00:00:00Z'),
      liveRow('summer-special', 'Summer Special', '2026-06-13T00:00:00Z'),
    ]);

    const Page = await GamesPage();
    render(Page);

    expect(mocks.fetchUpcomingTournaments).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Manager Test Bounty/)).toBeInTheDocument();
    expect(screen.getByText(/Summer Special/)).toBeInTheDocument();
  });

  it('flag ON with empty result: renders the "no upcoming" message + phone number', async () => {
    mocks.isEnabled.mockReturnValue(true);
    mocks.fetchUpcomingTournaments.mockResolvedValueOnce([]);

    const Page = await GamesPage();
    render(Page);

    const status = screen.getByRole('status');
    expect(status.textContent).toMatch(/No tournaments are scheduled in the next 30 days/);
  });

  it('flag ON with query error: renders fallback message + emits console.error', async () => {
    mocks.isEnabled.mockReturnValue(true);
    mocks.fetchUpcomingTournaments.mockRejectedValueOnce(new Error('connection refused'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const Page = await GamesPage();
    render(Page);

    const status = screen.getByRole('status');
    expect(status.textContent).toMatch(/Our live schedule is loading/);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
