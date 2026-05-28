/**
 * Unit tests for `app/(marketing)/games/[slug]/page.tsx` (ADR-0037
 * §`/games/[slug]` rendering).
 *
 * Run locally:    pnpm test tests/pages/games-slug.test.tsx
 * Prerequisites:  none — pure module mocks.
 *
 * Coverage:
 *   - Known slug → renders tournament name + buy-in.
 *   - Unknown slug → calls notFound() (next/navigation contract throws
 *     a `NEXT_NOT_FOUND` error).
 *   - Canceled status is collapsed to null by the query helper → 404 path.
 *   - generateMetadata returns "Tournament not found" for unknown slug.
 *   - generateMetadata returns tournament title + description for known slug.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Tournament } from '@/lib/tournaments/types';

const mocks = vi.hoisted(() => ({
  fetchTournamentBySlug: vi.fn<(slug: string) => Promise<Tournament | null>>(),
  notFound: vi.fn(() => {
    const e = new Error('NEXT_NOT_FOUND');
    (e as Error & { digest?: string }).digest = 'NEXT_NOT_FOUND';
    throw e;
  }),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));
vi.mock('@/lib/tournaments/queries', () => ({
  fetchTournamentBySlug: mocks.fetchTournamentBySlug,
}));

import TournamentPage, { generateMetadata } from '@/app/(marketing)/games/[slug]/page';

const sample = (
  slug: string,
  name: string,
  status: Tournament['status'] = 'scheduled',
): Tournament => ({
  id: '00000000-0000-0000-0000-000000000000',
  slug,
  name,
  startsAt: '2026-06-10T00:00:00Z',
  tzName: 'America/Chicago',
  buyInCents: 15000,
  capacity: 40,
  gameType: 'nlhe',
  structureMd: null,
  status,
  sourceTemplateId: null,
  venueName: 'Members Only Poker Social Club',
  venueAddress: '16525 North Fwy, Houston, TX 77090',
});

beforeEach(() => {
  mocks.fetchTournamentBySlug.mockReset();
  mocks.notFound.mockClear();
});

describe('TournamentPage rendering', () => {
  it('known slug: renders tournament name + buy-in via formatMoney', async () => {
    mocks.fetchTournamentBySlug.mockResolvedValueOnce(sample('tuesday-bounty', 'Tuesday Bounty'));

    const Page = await TournamentPage({ params: { slug: 'tuesday-bounty' } });
    render(Page);

    expect(screen.getByText('Tuesday Bounty')).toBeInTheDocument();
    // 15000 cents → $150.00
    expect(screen.getByText(/\$150\.00/)).toBeInTheDocument();
    expect(screen.getByText('40 seats')).toBeInTheDocument();
  });

  it('unknown slug: calls notFound (next/navigation throws NEXT_NOT_FOUND)', async () => {
    mocks.fetchTournamentBySlug.mockResolvedValueOnce(null);

    await expect(TournamentPage({ params: { slug: 'never-existed' } })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(mocks.notFound).toHaveBeenCalledTimes(1);
  });

  it('canceled status (already collapsed to null by the helper) → 404', async () => {
    // The query helper returns null for canceled rows; mock that contract.
    mocks.fetchTournamentBySlug.mockResolvedValueOnce(null);

    await expect(TournamentPage({ params: { slug: 'tuesday-bounty-2026-06-09' } })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });
});

describe('TournamentPage generateMetadata', () => {
  it('returns "Tournament not found" metadata for unknown slug', async () => {
    mocks.fetchTournamentBySlug.mockResolvedValueOnce(null);
    const md = await generateMetadata({ params: { slug: 'missing' } });
    expect(md.title).toBe('Tournament not found');
  });

  it('returns name + description for known slug', async () => {
    mocks.fetchTournamentBySlug.mockResolvedValueOnce(sample('tuesday-bounty', 'Tuesday Bounty'));
    const md = await generateMetadata({ params: { slug: 'tuesday-bounty' } });
    expect(md.title).toBe('Tuesday Bounty');
    expect(typeof md.description).toBe('string');
    expect((md.description as string).toLowerCase()).toContain('buy-in');
  });

  it('falls through to "Tournament not found" when fetch throws (metadata path is fault-tolerant)', async () => {
    mocks.fetchTournamentBySlug.mockRejectedValueOnce(new Error('db'));
    const md = await generateMetadata({ params: { slug: 'tuesday-bounty' } });
    expect(md.title).toBe('Tournament not found');
  });
});
