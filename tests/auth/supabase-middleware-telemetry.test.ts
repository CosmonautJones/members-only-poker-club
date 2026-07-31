import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getUser, nextResponse } = vi.hoisted(() => ({
  getUser: vi.fn(),
  nextResponse: { cookies: { set: vi.fn() } },
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser },
  })),
}));

vi.mock('next/server', () => ({
  NextResponse: {
    next: vi.fn(() => nextResponse),
  },
}));

import { SUPABASE_AUTH_TIMEOUT_MS, updateSession } from '@/lib/supabase/middleware';

const originalUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
const originalAnonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

beforeEach(() => {
  process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'https://project.supabase.co';
  process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'test-anon-key';
  getUser.mockResolvedValue({
    data: {
      user: {
        id: 'private-user-id',
        email: 'member@example.com',
      },
    },
    error: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  getUser.mockReset();

  if (originalUrl === undefined) {
    delete process.env['NEXT_PUBLIC_SUPABASE_URL'];
  } else {
    process.env['NEXT_PUBLIC_SUPABASE_URL'] = originalUrl;
  }

  if (originalAnonKey === undefined) {
    delete process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  } else {
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = originalAnonKey;
  }
});

describe('Supabase middleware success telemetry', () => {
  it('emits only a PII-free event name and non-negative duration', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const request = {
      cookies: {
        getAll: vi.fn(() => []),
        set: vi.fn(),
      },
      nextUrl: {
        pathname: '/admin',
        href: 'https://members-only.example/admin?token=private&email=member@example.com',
      },
    } as unknown as Parameters<typeof updateSession>[0];

    await updateSession(request);

    expect(info).toHaveBeenCalledOnce();
    const line = JSON.parse(String(info.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(line).toEqual({
      event: 'supabase_auth_ok',
      duration_ms: expect.any(Number),
    });
    expect(line['duration_ms']).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(line)).not.toContain('private');
    expect(JSON.stringify(line)).not.toContain('member@example.com');
    expect(JSON.stringify(line)).not.toContain('private-user-id');
    expect(JSON.stringify(line)).not.toContain('/admin');
  });

  it('retains the provisional three-second timeout guard', () => {
    expect(SUPABASE_AUTH_TIMEOUT_MS).toBe(3000);
  });
});
