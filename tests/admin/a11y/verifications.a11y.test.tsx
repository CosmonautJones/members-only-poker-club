/**
 * axe-core a11y sweep for `app/(admin)/admin/verifications/page.tsx` —
 * ADR-0035 AC33 / WD.T23 (t20).
 *
 * The verifications page renders the queue body inside a `<Suspense>`
 * boundary, so we use the shared `resolveAsyncChildren` walker to
 * materialize the async server component before handing the tree to
 * axe-core.
 *
 * Mock plumbing mirrors `tests/admin/verifications-page.test.tsx`.
 */

import { describe, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

import {
  expectNoSeriousAxeViolations,
  resolveAsyncChildren,
  BASE_MANAGER_PROFILE,
} from './_helpers';

// ---- Hoisted mock primitives ----------------------------------------------

type SignedUrlEntry =
  | { ok: true; signedUrl: string }
  | { ok: false; error: { message: string } }
  | { ok: 'throw' };

type MockShape = {
  requireRole: ReturnType<
    typeof vi.fn<
      (required: string) => Promise<{
        profile: { id: string; role: string; full_name: string; email: string };
      }>
    >
  >;
  profilesResult: {
    data: Array<Record<string, unknown>>;
    error: { message: string } | null;
  };
  signedUrls: Map<string, SignedUrlEntry>;
  createSignedUrl: ReturnType<typeof vi.fn<(path: string, ttl: number) => Promise<unknown>>>;
  storageFrom: ReturnType<
    typeof vi.fn<(bucket: string) => { createSignedUrl: MockShape['createSignedUrl'] }>
  >;
};

const mocks: MockShape = vi.hoisted(
  (): MockShape => ({
    requireRole: vi.fn(),
    profilesResult: { data: [], error: null },
    signedUrls: new Map<string, SignedUrlEntry>(),
    createSignedUrl: vi.fn(),
    storageFrom: vi.fn(),
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

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => {
    function makeChain() {
      const chain: Record<string, unknown> = {};
      const passthrough = () => chain;
      for (const m of [
        'select',
        'is',
        'not',
        'eq',
        'like',
        'order',
        'limit',
        'gt',
        'gte',
        'lt',
        'lte',
        'in',
        'or',
        'ilike',
        'filter',
        'range',
      ]) {
        chain[m] = passthrough;
      }
      chain['then'] = (
        onFulfilled: (v: { data?: unknown; error?: { message: string } | null }) => unknown,
      ) => Promise.resolve(mocks.profilesResult).then(onFulfilled);
      return chain;
    }
    return {
      from: (_table: string) => makeChain(),
      storage: {
        from: (bucket: string) => mocks.storageFrom(bucket),
      },
    };
  },
}));

// ---- Import AFTER mocks ---------------------------------------------------

// eslint-disable-next-line import/first
import VerificationsPage from '@/app/(admin)/admin/verifications/page';

// ---- Fixtures -------------------------------------------------------------

const UPLOAD_AT_ISO = '2026-05-15T14:32:08.000Z';

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'uuid-row-a',
    full_name: 'Alice Adams',
    email: 'alice@example.com',
    dob: '1990-01-01', // AGE OK
    id_doc_path: 'profiles/uuid-row-a/front.jpg',
    id_doc_uploaded_at: UPLOAD_AT_ISO,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.requireRole.mockResolvedValue({ profile: BASE_MANAGER_PROFILE });
  mocks.profilesResult = { data: [], error: null };
  mocks.signedUrls.clear();
  mocks.createSignedUrl.mockReset();
  mocks.createSignedUrl.mockImplementation(async (path: string, _ttl: number) => {
    const entry = mocks.signedUrls.get(path);
    if (!entry) {
      return { data: { signedUrl: `https://signed.test/${path}` }, error: null };
    }
    if (entry.ok === true) {
      return { data: { signedUrl: entry.signedUrl }, error: null };
    }
    if (entry.ok === 'throw') {
      throw new Error(`signed-url-rejection for ${path}`);
    }
    return { data: null, error: entry.error };
  });
  mocks.storageFrom.mockReset();
  mocks.storageFrom.mockImplementation((_bucket: string) => ({
    createSignedUrl: mocks.createSignedUrl,
  }));
});

async function renderPage(): Promise<HTMLElement> {
  const tree = (await VerificationsPage()) as React.ReactElement;
  const resolved = await resolveAsyncChildren(tree);
  const { container } = render(resolved);
  return container;
}

// ---- Tests ----------------------------------------------------------------

describe('admin verifications — axe-core a11y (AC33)', () => {
  it('has no serious or critical axe violations with rows present', async () => {
    mocks.profilesResult = {
      data: [
        row({
          id: 'uuid-row-a',
          full_name: 'Alice Adams',
          email: 'alice@example.com',
          dob: '1990-01-01',
        }),
        row({
          id: 'uuid-row-b',
          full_name: 'Bob Beta',
          email: 'bob@example.com',
          // Under 21 — exercises the red "UNDER 21 — REJECT" banner.
          dob: '2010-01-01',
          id_doc_path: 'profiles/uuid-row-b/front.jpg',
        }),
      ],
      error: null,
    };
    const container = await renderPage();
    await expectNoSeriousAxeViolations(container);
  });

  it('has no serious or critical axe violations in the empty-state branch', async () => {
    mocks.profilesResult = { data: [], error: null };
    const container = await renderPage();
    await expectNoSeriousAxeViolations(container);
  });

  it('has no serious or critical axe violations when a signed-URL failed (thumbnail placeholder branch)', async () => {
    mocks.profilesResult = {
      data: [
        row({
          id: 'uuid-row-fail',
          email: 'fail@example.com',
          id_doc_path: 'profiles/uuid-row-fail/front.jpg',
        }),
      ],
      error: null,
    };
    mocks.signedUrls.set('profiles/uuid-row-fail/front.jpg', {
      ok: false,
      error: { message: 'object not found' },
    });
    const container = await renderPage();
    await expectNoSeriousAxeViolations(container);
  });
});
