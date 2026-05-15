/**
 * Tests for the Privacy & data link in app/(member)/profile/page.tsx — ADR-0023 AC9.
 *
 * Sub-cases:
 *   1. The rendered profile page includes an anchor with text matching /privacy & data/i.
 *   2. The anchor's href is "/profile/privacy".
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock next/link for the happy-dom environment.
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// Mock getCurrentProfile — the profile page is a server component that
// calls this. We return a minimal profile.
vi.mock('@/lib/auth/getCurrentProfile', () => ({
  getCurrentProfile: vi.fn().mockResolvedValue({
    id: 'test-user-id',
    email: 'test@example.com',
    role: 'member',
    full_name: 'Test User',
    dob: '1990-01-01',
    phone: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
  }),
}));

// server-only mock so the profile page doesn't throw in happy-dom.
vi.mock('server-only', () => ({}));

import ProfilePage from '@/app/(member)/profile/page';

describe('Profile page — Privacy & data link (AC9)', () => {
  it('renders a link with text matching /privacy & data/i', async () => {
    const page = await ProfilePage();
    render(page as React.ReactElement);

    const link = screen.getByRole('link', { name: /privacy & data/i });
    expect(link).toBeTruthy();
  });

  it('the Privacy & data link has href="/profile/privacy"', async () => {
    const page = await ProfilePage();
    render(page as React.ReactElement);

    const link = screen.getByRole('link', { name: /privacy & data/i });
    expect(link.getAttribute('href')).toBe('/profile/privacy');
  });
});
