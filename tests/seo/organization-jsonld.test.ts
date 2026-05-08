/**
 * AC6 / T7 — Organization JSON-LD on the home page.
 *
 * Acceptance criterion 6 of `docs/specs/0030-seo-and-content-strategy-implementation.md`
 * requires the `/` page to render a JSON-LD block with `@type: "Organization"`
 * containing `name`, `url`, `logo`, and `sameAs`. The component under test
 * is `components/seo/organization-jsonld.tsx`, which T7 introduces and
 * `app/(marketing)/page.tsx` mounts.
 *
 * This test mirrors the pattern of the existing
 * `tests/seo/local-business-jsonld.test.ts`:
 *   1. Stub the `server-only` package so the `<JsonLd>` server component
 *      can be imported under vitest's happy-dom environment.
 *   2. Use `React.createElement` (not JSX) so the file can be `.test.ts`
 *      without a TSX transform.
 *   3. Use `renderToString` from `react-dom/server` to materialise the
 *      `<script type="application/ld+json">` element, then parse the
 *      embedded payload and assert on the schema.org fields.
 *
 * URL/logo/sameAs values may still be placeholder strings while the
 * owner-supplied brand assets land — the spec explicitly allows this.
 * This test only enforces presence and type, not final values.
 */

import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

// Neutralise `server-only` so importing the JSON-LD components does not
// throw under vitest's happy-dom environment. (`server-only` is a
// build-time guard in Next.js; it is irrelevant inside a unit-test
// process.)
vi.mock('server-only', () => ({}));

import { NAP } from '@/lib/content/nap';
import { OrganizationJsonLd } from '@/components/seo/organization-jsonld';

function extractJsonLdPayload(html: string): Record<string, unknown> {
  const match = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  expect(match).not.toBeNull();
  const rawJson = match![1];
  expect(typeof rawJson).toBe('string');
  return JSON.parse(rawJson as string) as Record<string, unknown>;
}

describe('<OrganizationJsonLd /> (AC6 / T7)', () => {
  it('renders a <script type="application/ld+json"> element', () => {
    const html = renderToString(React.createElement(OrganizationJsonLd as React.FC));
    expect(html).toContain('type="application/ld+json"');
  });

  it('emits a schema.org Organization payload', () => {
    const html = renderToString(React.createElement(OrganizationJsonLd as React.FC));
    const payload = extractJsonLdPayload(html);

    expect(payload['@context']).toBe('https://schema.org');
    expect(payload['@type']).toBe('Organization');
  });

  it('payload `name` matches NAP.name (single source of truth)', () => {
    const html = renderToString(React.createElement(OrganizationJsonLd as React.FC));
    const payload = extractJsonLdPayload(html);

    expect(payload.name).toBe(NAP.name);
  });

  it('payload includes `url`, `logo`, and `sameAs` (presence-only; placeholder values are OK)', () => {
    const html = renderToString(React.createElement(OrganizationJsonLd as React.FC));
    const payload = extractJsonLdPayload(html);

    // url: required, must be a non-empty string
    expect(payload).toHaveProperty('url');
    expect(typeof payload.url).toBe('string');
    expect((payload.url as string).length).toBeGreaterThan(0);

    // logo: required; schema.org allows either a URL string or an
    // ImageObject. Accept both shapes — only enforce presence + type.
    expect(payload).toHaveProperty('logo');
    const logo = payload.logo;
    const logoIsString = typeof logo === 'string' && logo.length > 0;
    const logoIsImageObject =
      typeof logo === 'object' &&
      logo !== null &&
      typeof (logo as Record<string, unknown>).url === 'string' &&
      ((logo as Record<string, unknown>).url as string).length > 0;
    expect(logoIsString || logoIsImageObject).toBe(true);

    // sameAs: required; schema.org expects an array of URL strings.
    expect(payload).toHaveProperty('sameAs');
    expect(Array.isArray(payload.sameAs)).toBe(true);
  });
});
