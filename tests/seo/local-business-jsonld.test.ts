/**
 * AC5 / T6 — LocalBusiness JSON-LD on /contact + NAP source-of-truth.
 *
 * Validates two surfaces from the spec
 * (`docs/specs/0030-seo-and-content-strategy-implementation.md` AC5):
 *
 *   1. `lib/content/nap.ts` exports a `NAP` constant whose address fields
 *      match the real Houston venue (`16525 North Fwy, Houston, TX 77090, US`)
 *      and whose `name`, `telephone`, and `openingHoursSpecification` fields
 *      have the expected shape (telephone/hours may be TODO placeholders;
 *      this test only enforces structure, not their final values).
 *
 *   2. `<LocalBusinessJsonLd />` renders a `<script type="application/ld+json">`
 *      whose parsed JSON payload has `@context: "https://schema.org"`,
 *      `@type: "LocalBusiness"`, and an `address.streetAddress` exactly equal
 *      to the real street address from the NAP module.
 *
 * Implementation notes:
 *   - `components/seo/json-ld.tsx` declares `import "server-only"`. The
 *     `server-only` package's default entry throws on import in a non-server
 *     context, which would break vitest under happy-dom. We neutralise it
 *     with a `vi.mock("server-only", ...)` stub so the React server-component
 *     module can be imported and rendered with `renderToString`.
 *   - The file is intentionally `.test.ts` (not `.tsx`); we use
 *     `React.createElement` rather than JSX so no TSX transform is required.
 *   - `renderToString` from `react-dom/server` is sufficient to materialise
 *     the JSON-LD `<script>` tag — the component is a pure server component
 *     with no hooks and no effects.
 */

import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

// Neutralise `server-only` so importing the JSON-LD components does not throw
// under vitest's happy-dom environment. (`server-only` is a build-time guard
// in Next.js; it is irrelevant inside a unit-test process.)
vi.mock('server-only', () => ({}));

import { NAP } from '@/lib/content/nap';
import { LocalBusinessJsonLd } from '@/components/seo/local-business-jsonld';

describe('NAP source of truth (AC5 / T6)', () => {
  it('uses the real Houston street address (AC5 tightening)', () => {
    expect(NAP.address.streetAddress).toBe('16525 North Fwy');
    expect(NAP.address.addressLocality).toBe('Houston');
    expect(NAP.address.addressRegion).toBe('TX');
    expect(NAP.address.postalCode).toBe('77090');
    expect(NAP.address.addressCountry).toBe('US');
  });

  it('exports a non-empty `name`', () => {
    expect(typeof NAP.name).toBe('string');
    expect(NAP.name.trim().length).toBeGreaterThan(0);
  });

  it('exports `telephone` as a string (placeholder is OK; structural only)', () => {
    expect(typeof NAP.telephone).toBe('string');
    expect((NAP.telephone as string).length).toBeGreaterThan(0);
  });

  it('exports `openingHoursSpecification` as a non-empty array', () => {
    expect(Array.isArray(NAP.openingHoursSpecification)).toBe(true);
    expect(NAP.openingHoursSpecification.length).toBeGreaterThan(0);
  });
});

describe('<LocalBusinessJsonLd /> (AC5 / T6)', () => {
  it('renders a <script type="application/ld+json"> element', () => {
    const html = renderToString(React.createElement(LocalBusinessJsonLd as React.FC));
    expect(html).toContain('type="application/ld+json"');
  });

  it('emits a schema.org LocalBusiness payload with the real address', () => {
    const html = renderToString(React.createElement(LocalBusinessJsonLd as React.FC));

    const match = html.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();

    // `match` is non-null per the assertion above; the bang is safe here.
    const rawJson = match![1];
    expect(typeof rawJson).toBe('string');

    let payload: Record<string, unknown>;
    expect(() => {
      payload = JSON.parse(rawJson as string);
    }).not.toThrow();

    // Re-parse for type-narrow access after the structural check above.
    payload = JSON.parse(rawJson as string);

    expect(payload['@context']).toBe('https://schema.org');
    expect(payload['@type']).toBe('LocalBusiness');
    expect(payload.name).toBe(NAP.name);

    const address = payload.address as Record<string, unknown>;
    expect(address).toBeDefined();
    expect(address.streetAddress).toBe('16525 North Fwy');
    expect(address.addressLocality).toBe(NAP.address.addressLocality);
    expect(address.addressRegion).toBe(NAP.address.addressRegion);
    expect(address.postalCode).toBe(NAP.address.postalCode);
    expect(address.addressCountry).toBe(NAP.address.addressCountry);
  });
});
