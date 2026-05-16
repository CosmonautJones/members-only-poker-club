/**
 * Unit tests for `app/(admin)/admin/verifications/page.tsx` —
 * the AC11 ID-verification queue (ADR-0035 WB.T7).
 *
 * Run locally:    pnpm test tests/admin/verifications-page.test.tsx
 * Prerequisites:  none — pure module mocks (no DB, no network).
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC11
 *       (server-side filtered query + signed-URL thumbnails + 21+
 *       banner + UTC/Central timestamps + empty state +
 *       signed-URL failure-mode placeholder).
 *
 * SUT contract (per AC11):
 *   - Server component. FIRST body statement is
 *     `await requireRole('manager');`
 *   - Query: profiles WHERE id_verified_at IS NULL
 *     AND id_doc_uploaded_at IS NOT NULL
 *     AND id_verification_rejected_at IS NULL.
 *   - Per row: 1-hour-TTL signed URL from
 *     `supabase.storage.from('id-documents').createSignedUrl(path, 3600)`,
 *     `<img referrerPolicy="no-referrer" alt="ID document thumbnail for {email}">`.
 *   - DOB banner: verbatim "AGE OK" green / "UNDER 21 — REJECT" red.
 *   - Upload timestamp: UTC + Central per ADR-0034.
 *   - Three action buttons (Approve, Reject, Request more info),
 *     disabled until t10/t11/t14 ship.
 *   - Empty state: literal "No rows match these filters."
 *   - Signed-URL failure: `<tr data-thumb-failed="true">` with the
 *     literal "Thumbnail unavailable — refresh" placeholder; the
 *     three action buttons remain on the row.
 *
 * Mocking strategy mirrors `tests/admin/dashboard-page.test.tsx`:
 *   - vi.mock('server-only')
 *   - vi.mock('next/navigation', { redirect })
 *   - vi.mock('@/lib/auth/requireRole')
 *   - vi.mock('@/lib/supabase/server') — fluent-builder spy that
 *     surfaces `from('profiles')` data + `storage.from('id-documents').createSignedUrl(path, ttl)`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

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
    profilesResult: {
      data: [],
      error: null,
    },
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

// ---- Import AFTER vi.mock so the SUT picks up the stubs -------------------

// eslint-disable-next-line import/first
import VerificationsPage from '@/app/(admin)/admin/verifications/page';

// ---- Test helpers ---------------------------------------------------------

const baseProfile = {
  id: 'uuid-test-manager',
  role: 'manager',
  full_name: 'Test Manager',
  email: 'manager@example.com',
};

// Stable "uploaded" timestamp used across tests so timestamp assertions
// can pin literal substrings. 2026-05-15T14:32:08 UTC → 09:32:08 CDT
// in America/Chicago (May → daylight time).
const UPLOAD_AT_ISO = '2026-05-15T14:32:08.000Z';

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.requireRole.mockResolvedValue({ profile: baseProfile });

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

/**
 * Render the page and unwrap its Suspense boundary so the queue body
 * is materialized. We synchronously await the page's top-level element
 * (a Server Component returns a Promise), then resolve the async child
 * (`VerificationsQueue`) the same way. happy-dom does not implement
 * the React server-renderer's Suspense streaming, so we render the
 * inner promise manually — this mirrors the pattern in
 * `tests/admin/dashboard-page.test.tsx`.
 */
async function renderPage(): Promise<void> {
  const tree = (await VerificationsPage()) as React.ReactElement;
  // The tree contains a <Suspense> whose child is an async element.
  // Walk to it, await it, and render the resolved tree.
  // To keep the test resilient against minor SUT layout shifts, fall
  // back to rendering the tree as-is if we can't find the async child.
  const resolved = await resolveAsyncChildren(tree);
  render(resolved);
}

// Recursively await any Promise children — happy-dom can't run the
// Suspense pipeline, so we materialize async components manually.
async function resolveAsyncChildren(node: React.ReactNode): Promise<React.ReactElement> {
  if (
    node &&
    typeof node === 'object' &&
    'then' in (node as object) &&
    typeof (node as Promise<unknown>).then === 'function'
  ) {
    const awaited = (await node) as React.ReactNode;
    return resolveAsyncChildren(awaited);
  }
  if (!node || typeof node !== 'object' || !('props' in (node as object))) {
    return node as React.ReactElement;
  }
  const el = node as React.ReactElement & { type: unknown };
  // If the element's type is an async function (e.g. VerificationsQueue),
  // call it and recurse on the result.
  if (typeof el.type === 'function') {
    const fn = el.type as (props: Record<string, unknown>) => unknown;
    // Components that throw on first render (e.g. requireRole) are
    // assumed to have already resolved at the outer await.
    try {
      const ret = fn(el.props as Record<string, unknown>);
      if (ret && typeof ret === 'object' && 'then' in ret) {
        const awaited = (await (ret as Promise<unknown>)) as React.ReactNode;
        return resolveAsyncChildren(awaited);
      }
      // Fall through — non-async function components render normally.
    } catch {
      // Non-async component that we can't pre-render here; let RTL handle it.
    }
  }
  // Walk children
  const props = el.props as { children?: React.ReactNode };
  if (props.children !== undefined) {
    if (Array.isArray(props.children)) {
      const newKids = await Promise.all(
        props.children.map(async (k, i) => {
          const resolved = await resolveAsyncChildren(k);
          // Preserve existing keys; otherwise mint index-based keys so
          // React doesn't warn during the test render (Suspense's
          // skeleton vs. resolved-child swap can lose keys here).
          if (
            resolved &&
            typeof resolved === 'object' &&
            'props' in (resolved as object) &&
            (resolved as React.ReactElement).key == null
          ) {
            return { ...(resolved as React.ReactElement), key: `__t-${i}` };
          }
          return resolved;
        }),
      );
      return { ...el, props: { ...el.props, children: newKids } };
    }
    const newChild = await resolveAsyncChildren(props.children);
    return { ...el, props: { ...el.props, children: newChild } };
  }
  return el;
}

// Convenience: shape one queue row.
function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'uuid-row-a',
    full_name: 'Alice Adams',
    email: 'alice@example.com',
    dob: '1990-01-01', // age 35+ → AGE OK
    id_doc_path: 'profiles/uuid-row-a/front.jpg',
    id_doc_uploaded_at: UPLOAD_AT_ISO,
    ...overrides,
  };
}

// ---- Tests ----------------------------------------------------------------

describe('verifications page — requireRole gate', () => {
  it('calls requireRole("manager") as the first body statement', async () => {
    await renderPage();
    expect(mocks.requireRole).toHaveBeenCalledTimes(1);
    expect(mocks.requireRole).toHaveBeenCalledWith('manager');
  });

  it('propagates a thrown InsufficientRoleError from requireRole', async () => {
    const err = new Error('InsufficientRoleError');
    err.name = 'InsufficientRoleError';
    mocks.requireRole.mockRejectedValueOnce(err);
    await expect(VerificationsPage()).rejects.toThrow(/InsufficientRoleError/);
  });
});

describe('verifications page — empty state', () => {
  it('renders the literal "No rows match these filters." copy when no rows', async () => {
    mocks.profilesResult = { data: [], error: null };
    await renderPage();
    expect(screen.getByText('No rows match these filters.')).toBeTruthy();
  });
});

describe('verifications page — populated queue (over-21 row)', () => {
  beforeEach(() => {
    mocks.profilesResult = {
      data: [
        row({
          id: 'uuid-over-21',
          full_name: 'Alice Adams',
          email: 'alice@example.com',
          dob: '1990-01-01',
          id_doc_path: 'profiles/uuid-over-21/front.jpg',
          id_doc_uploaded_at: UPLOAD_AT_ISO,
        }),
      ],
      error: null,
    };
    mocks.signedUrls.set('profiles/uuid-over-21/front.jpg', {
      ok: true,
      signedUrl: 'https://signed.test/alice.jpg',
    });
  });

  it('renders the full_name, email, thumbnail, age banner, and UTC+Central timestamp', async () => {
    await renderPage();

    // Full name + email.
    expect(screen.getByText('Alice Adams')).toBeTruthy();
    expect(screen.getByText('alice@example.com')).toBeTruthy();

    // Thumbnail: signed URL + alt + referrerPolicy.
    const img = screen.getByAltText(
      'ID document thumbnail for alice@example.com',
    ) as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('https://signed.test/alice.jpg');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');

    // 21+ banner.
    expect(screen.getByText('AGE OK')).toBeTruthy();

    // UTC + Central timestamp pair.
    expect(screen.getByText(/14:32:08\s+UTC/)).toBeTruthy();
    expect(screen.getByText(/09:32:08\s+CDT/)).toBeTruthy();
  });

  it('uses the id-documents bucket and a 3600-second TTL for the signed URL', async () => {
    await renderPage();
    expect(mocks.storageFrom).toHaveBeenCalledWith('id-documents');
    expect(mocks.createSignedUrl).toHaveBeenCalledWith('profiles/uuid-over-21/front.jpg', 3600);
  });

  it('renders three action buttons (Approve / Reject / Request more info)', async () => {
    await renderPage();
    expect(screen.getByRole('button', { name: /^approve$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^reject$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /request more info/i })).toBeTruthy();
  });

  it('age-OK banner is themed green (data-age-ok="true")', async () => {
    await renderPage();
    const banner = screen.getByText('AGE OK');
    expect(banner.getAttribute('data-age-ok')).toBe('true');
  });
});

describe('verifications page — under-21 banner', () => {
  beforeEach(() => {
    // A DOB ~5 years in the past → under 21.
    const fiveYearsAgo = new Date();
    fiveYearsAgo.setUTCFullYear(fiveYearsAgo.getUTCFullYear() - 5);
    const dobIso = fiveYearsAgo.toISOString().slice(0, 10);

    mocks.profilesResult = {
      data: [
        row({
          id: 'uuid-under-21',
          full_name: 'Young Member',
          email: 'young@example.com',
          dob: dobIso,
          id_doc_path: 'profiles/uuid-under-21/front.jpg',
          id_doc_uploaded_at: UPLOAD_AT_ISO,
        }),
      ],
      error: null,
    };
    mocks.signedUrls.set('profiles/uuid-under-21/front.jpg', {
      ok: true,
      signedUrl: 'https://signed.test/young.jpg',
    });
  });

  it('renders the verbatim "UNDER 21 — REJECT" copy in red (data-age-ok="false")', async () => {
    await renderPage();
    const banner = screen.getByText('UNDER 21 — REJECT');
    expect(banner).toBeTruthy();
    expect(banner.getAttribute('data-age-ok')).toBe('false');
  });
});

describe('verifications page — signed-URL failure mode (AC11 error branch)', () => {
  beforeEach(() => {
    mocks.profilesResult = {
      data: [
        row({
          id: 'uuid-fail',
          full_name: 'Broken Thumb',
          email: 'broken@example.com',
          dob: '1990-01-01',
          id_doc_path: 'profiles/uuid-fail/front.jpg',
          id_doc_uploaded_at: UPLOAD_AT_ISO,
        }),
      ],
      error: null,
    };
    mocks.signedUrls.set('profiles/uuid-fail/front.jpg', { ok: 'throw' });
  });

  it('renders "Thumbnail unavailable — refresh" placeholder when createSignedUrl rejects', async () => {
    await renderPage();
    expect(screen.getByText('Thumbnail unavailable — refresh')).toBeTruthy();
    // No <img> for the row.
    expect(screen.queryByAltText(/ID document thumbnail for broken@example.com/)).toBeNull();
  });

  it('marks the row with data-thumb-failed="true"', async () => {
    await renderPage();
    const placeholder = screen.getByText('Thumbnail unavailable — refresh');
    const row = placeholder.closest('tr');
    expect(row).toBeTruthy();
    expect(row?.getAttribute('data-thumb-failed')).toBe('true');
  });

  it('keeps the three action buttons present on the failed-thumbnail row', async () => {
    await renderPage();
    const placeholder = screen.getByText('Thumbnail unavailable — refresh');
    const row = placeholder.closest('tr') as HTMLElement;
    expect(within(row).getByRole('button', { name: /^approve$/i })).toBeTruthy();
    expect(within(row).getByRole('button', { name: /^reject$/i })).toBeTruthy();
    expect(within(row).getByRole('button', { name: /request more info/i })).toBeTruthy();
  });

  it('handles the structured-error path (createSignedUrl returns { error } instead of throwing)', async () => {
    mocks.signedUrls.set('profiles/uuid-fail/front.jpg', {
      ok: false,
      error: { message: 'storage 5xx' },
    });
    await renderPage();
    expect(screen.getByText('Thumbnail unavailable — refresh')).toBeTruthy();
    const placeholder = screen.getByText('Thumbnail unavailable — refresh');
    expect(placeholder.closest('tr')?.getAttribute('data-thumb-failed')).toBe('true');
  });
});

describe('verifications page — mixed queue (one success, one failure)', () => {
  beforeEach(() => {
    mocks.profilesResult = {
      data: [
        row({
          id: 'uuid-ok',
          full_name: 'Good Row',
          email: 'good@example.com',
          dob: '1990-01-01',
          id_doc_path: 'profiles/uuid-ok/front.jpg',
        }),
        row({
          id: 'uuid-bad',
          full_name: 'Bad Row',
          email: 'bad@example.com',
          dob: '1990-01-01',
          id_doc_path: 'profiles/uuid-bad/front.jpg',
        }),
      ],
      error: null,
    };
    mocks.signedUrls.set('profiles/uuid-ok/front.jpg', {
      ok: true,
      signedUrl: 'https://signed.test/good.jpg',
    });
    mocks.signedUrls.set('profiles/uuid-bad/front.jpg', { ok: 'throw' });
  });

  it('renders the successful row with an <img> AND the failed row with a placeholder', async () => {
    await renderPage();
    expect(screen.getByAltText('ID document thumbnail for good@example.com')).toBeTruthy();
    expect(screen.getByText('Thumbnail unavailable — refresh')).toBeTruthy();
    expect(screen.getByText('Good Row')).toBeTruthy();
    expect(screen.getByText('Bad Row')).toBeTruthy();
  });
});

describe('verifications page — source invariants (AC5 + AC11)', () => {
  it('the page does not declare "use client" — it is a server component', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const PAGE_PATH = path.resolve(
      __dirname,
      '..',
      '..',
      'app',
      '(admin)',
      'admin',
      'verifications',
      'page.tsx',
    );
    const src = readFileSync(PAGE_PATH, 'utf8');
    expect(src).not.toContain("'use client'");
    expect(src).not.toContain('"use client"');
  });

  it("first body statement is `await requireRole('manager')` (AC5 defense-in-depth)", async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const PAGE_PATH = path.resolve(
      __dirname,
      '..',
      '..',
      'app',
      '(admin)',
      'admin',
      'verifications',
      'page.tsx',
    );
    const src = readFileSync(PAGE_PATH, 'utf8');

    const exportMatch = src.match(
      /export\s+default\s+async\s+function\s+\w+\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/,
    );
    expect(exportMatch).toBeTruthy();
    const bodyStart = exportMatch!.index! + exportMatch![0].length;

    let i = bodyStart;
    const advancePastTrivia = (): void => {
      while (i < src.length) {
        if (/\s/.test(src[i]!)) {
          i += 1;
          continue;
        }
        if (src.slice(i, i + 2) === '//') {
          const eol = src.indexOf('\n', i);
          i = eol === -1 ? src.length : eol + 1;
          continue;
        }
        if (src.slice(i, i + 2) === '/*') {
          const end = src.indexOf('*/', i + 2);
          i = end === -1 ? src.length : end + 2;
          continue;
        }
        break;
      }
    };
    advancePastTrivia();

    const firstStmt = src.slice(i, i + 80);
    expect(firstStmt).toMatch(
      /^(?:const\s*\{\s*[^}]+\s*\}\s*=\s*)?await\s+requireRole\(\s*['"]manager['"]\s*\)/,
    );
  });

  it('uses cookie-scoped `createClient()` from `@/lib/supabase/server` (R1 mitigation)', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const PAGE_PATH = path.resolve(
      __dirname,
      '..',
      '..',
      'app',
      '(admin)',
      'admin',
      'verifications',
      'page.tsx',
    );
    const src = readFileSync(PAGE_PATH, 'utf8');
    expect(src).toMatch(/from\s*['"]@\/lib\/supabase\/server['"]/);
    expect(src).not.toMatch(/from\s*['"]@\/lib\/supabase\/admin['"]/);
  });

  it('renders `referrerPolicy="no-referrer"` on the thumbnail `<img>` (AC11 leak mitigation)', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const PAGE_PATH = path.resolve(
      __dirname,
      '..',
      '..',
      'app',
      '(admin)',
      'admin',
      'verifications',
      'page.tsx',
    );
    const src = readFileSync(PAGE_PATH, 'utf8');
    expect(src).toMatch(/referrerPolicy=["']no-referrer["']/);
  });
});
