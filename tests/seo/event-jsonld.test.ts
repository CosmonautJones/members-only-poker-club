/**
 * AC7 / T8 — Event JSON-LD on `/games/[slug]` (with typed fixture).
 *
 * Acceptance criterion 7 of
 * `docs/specs/0030-seo-and-content-strategy-implementation.md`:
 *   "/games/[slug] emits a JSON-LD `Event` block on the rendered HTML for
 *    any tournament slug, sourced from a typed fixture
 *    (`lib/tournaments/fixtures.ts`) shaped against the shared
 *    `Tournament` interface in `lib/tournaments/types.ts`."
 *
 * Two test groups:
 *
 *  Group 1 — Tournament fixture shape.
 *    Asserts `lib/tournaments/fixtures.ts` exports a `TOURNAMENTS` array
 *    with at least one entry, each conforming to the spec's required
 *    `Tournament` fields (`slug`, `name`, `startsAt`, `buyInCents`,
 *    `capacity`, `venueName`, `venueAddress`), and that
 *    `findTournamentBySlug(...)` is a working lookup helper.
 *
 *  Group 2 — `<EventJsonLd>` render.
 *    Mirrors the LocalBusiness JSON-LD test pattern: stub `server-only`,
 *    use `React.createElement` (no JSX so the file stays `.test.ts`),
 *    `renderToString` the component, then parse the embedded payload
 *    and assert on schema.org `@type: "Event"` plus the load-bearing
 *    fields the spec calls out (start date, offers price in dollars,
 *    location address containing the real Houston street address from
 *    `NAP`, and `maximumAttendeeCapacity`).
 */

import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

// Neutralise `server-only` so importing the JSON-LD components does not
// throw under vitest's happy-dom environment.
vi.mock('server-only', () => ({}));

import {
  TOURNAMENTS,
  findTournamentBySlug,
} from '@/lib/tournaments/fixtures';
import { EventJsonLd } from '@/components/seo/event-jsonld';

// -----------------------------------------------------------------------------
// Group 1 — Tournament fixture shape
// -----------------------------------------------------------------------------

describe('Tournament fixtures (AC7 / T8 — fixture shape)', () => {
  it('exports a non-empty TOURNAMENTS array', () => {
    expect(Array.isArray(TOURNAMENTS)).toBe(true);
    expect(TOURNAMENTS.length).toBeGreaterThanOrEqual(1);
  });

  it('every fixture carries the required Tournament fields', () => {
    for (const t of TOURNAMENTS) {
      // Field-by-field with named expectations so a failure points at
      // the missing field rather than dumping the whole object.
      expect(typeof t.slug, `slug on ${t.slug ?? '(unknown)'}`).toBe('string');
      expect((t.slug as string).length).toBeGreaterThan(0);

      expect(typeof t.name, `name on ${t.slug}`).toBe('string');
      expect((t.name as string).length).toBeGreaterThan(0);

      expect(typeof t.startsAt, `startsAt on ${t.slug}`).toBe('string');
      // ISO-8601 sanity — Date.parse() returns NaN for invalid strings.
      expect(Number.isFinite(Date.parse(t.startsAt))).toBe(true);

      expect(typeof t.buyInCents, `buyInCents on ${t.slug}`).toBe('number');
      expect(Number.isInteger(t.buyInCents)).toBe(true);
      expect(t.buyInCents).toBeGreaterThanOrEqual(0);

      expect(typeof t.capacity, `capacity on ${t.slug}`).toBe('number');
      expect(Number.isInteger(t.capacity)).toBe(true);
      expect(t.capacity).toBeGreaterThan(0);

      expect(typeof t.venueName, `venueName on ${t.slug}`).toBe('string');
      expect((t.venueName as string).length).toBeGreaterThan(0);

      expect(typeof t.venueAddress, `venueAddress on ${t.slug}`).toBe('string');
      expect((t.venueAddress as string).length).toBeGreaterThan(0);
    }
  });

  it('findTournamentBySlug returns the matched fixture for a known slug', () => {
    const found = findTournamentBySlug('saturday-night-deep-stack');
    expect(found).toBeDefined();
    expect(found?.slug).toBe('saturday-night-deep-stack');
  });

  it('findTournamentBySlug returns undefined for an unknown slug', () => {
    const missing = findTournamentBySlug('nope');
    expect(missing).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// Group 2 — <EventJsonLd /> render
// -----------------------------------------------------------------------------

function extractJsonLdPayload(html: string): Record<string, unknown> {
  const match = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  expect(match).not.toBeNull();
  const rawJson = match![1];
  expect(typeof rawJson).toBe('string');
  return JSON.parse(rawJson as string) as Record<string, unknown>;
}

describe('<EventJsonLd /> (AC7 / T8 — render)', () => {
  // Use the first fixture so this test does not depend on a specific
  // slug being present (the slug-lookup behaviour is exercised by
  // Group 1 above).
  const fixture = TOURNAMENTS[0]!;

  it('renders a <script type="application/ld+json"> element', () => {
    const html = renderToString(
      React.createElement(EventJsonLd, { tournament: fixture }),
    );
    expect(html).toContain('type="application/ld+json"');
  });

  it('emits a schema.org Event payload with @type: "Event"', () => {
    const html = renderToString(
      React.createElement(EventJsonLd, { tournament: fixture }),
    );
    const payload = extractJsonLdPayload(html);

    expect(payload['@context']).toBe('https://schema.org');
    expect(payload['@type']).toBe('Event');
  });

  it('startDate matches the fixture startsAt', () => {
    const html = renderToString(
      React.createElement(EventJsonLd, { tournament: fixture }),
    );
    const payload = extractJsonLdPayload(html);

    expect(payload.startDate).toBe(fixture.startsAt);
  });

  it('offers.price equals fixture buyInCents / 100', () => {
    const html = renderToString(
      React.createElement(EventJsonLd, { tournament: fixture }),
    );
    const payload = extractJsonLdPayload(html);

    const offers = payload.offers as Record<string, unknown> | undefined;
    expect(offers).toBeDefined();
    // schema.org `Offer.price` is conventionally either a number or a
    // numeric string; accept both shapes.
    const expectedDollars = fixture.buyInCents / 100;
    const priceNum =
      typeof offers!.price === 'number'
        ? (offers!.price as number)
        : Number.parseFloat(offers!.price as string);
    expect(priceNum).toBe(expectedDollars);
  });

  it('location.address contains the real Houston street address', () => {
    const html = renderToString(
      React.createElement(EventJsonLd, { tournament: fixture }),
    );
    const payload = extractJsonLdPayload(html);

    const location = payload.location as Record<string, unknown> | undefined;
    expect(location).toBeDefined();
    expect(location).toHaveProperty('address');

    // `address` may be a raw string or a PostalAddress object; in
    // either case the Houston street address must be present somewhere
    // in the serialised value.
    const addressSerialised = JSON.stringify(location!.address);
    expect(addressSerialised).toContain('16525 North Fwy');
  });

  it('maximumAttendeeCapacity matches the fixture capacity', () => {
    const html = renderToString(
      React.createElement(EventJsonLd, { tournament: fixture }),
    );
    const payload = extractJsonLdPayload(html);

    expect(payload.maximumAttendeeCapacity).toBe(fixture.capacity);
  });
});
