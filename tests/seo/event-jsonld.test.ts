/**
 * Event JSON-LD render tests (ADR-0030 AC7 — JSON-LD `Event` block on
 * `/games/[slug]`). Updated per ADR-0037 to drop the fixture-shape sub-
 * group; per-tournament data now lives in the `tournaments` table. The
 * load-bearing assertion — that `EventJsonLd` emits a schema.org Event
 * payload with the right field shape — is preserved.
 */

import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import type { Tournament } from '@/lib/tournaments/types';

vi.mock('server-only', () => ({}));

import { EventJsonLd } from '@/components/seo/event-jsonld';

const fixture: Tournament = {
  id: '00000000-0000-0000-0000-000000000000',
  slug: 'saturday-night-deep-stack',
  name: 'Saturday Night Deep Stack',
  startsAt: '2026-06-06T19:00:00-05:00',
  tzName: 'America/Chicago',
  buyInCents: 10_000,
  capacity: 60,
  gameType: 'nlhe',
  structureMd: null,
  status: 'scheduled',
  sourceTemplateId: null,
  venueName: 'Members Only Poker Social Club',
  venueAddress: '16525 North Fwy, Houston, TX 77090',
};

function extractJsonLdPayload(html: string): Record<string, unknown> {
  const match = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  expect(match).not.toBeNull();
  const rawJson = match![1];
  expect(typeof rawJson).toBe('string');
  return JSON.parse(rawJson as string) as Record<string, unknown>;
}

describe('<EventJsonLd /> (AC7 / T8 — render)', () => {
  it('renders a <script type="application/ld+json"> element', () => {
    const html = renderToString(React.createElement(EventJsonLd, { tournament: fixture }));
    expect(html).toContain('type="application/ld+json"');
  });

  it('emits a schema.org Event payload with @type: "Event"', () => {
    const html = renderToString(React.createElement(EventJsonLd, { tournament: fixture }));
    const payload = extractJsonLdPayload(html);
    expect(payload['@context']).toBe('https://schema.org');
    expect(payload['@type']).toBe('Event');
  });

  it('startDate matches the fixture startsAt', () => {
    const html = renderToString(React.createElement(EventJsonLd, { tournament: fixture }));
    const payload = extractJsonLdPayload(html);
    expect(payload.startDate).toBe(fixture.startsAt);
  });

  it('offers.price equals fixture buyInCents / 100', () => {
    const html = renderToString(React.createElement(EventJsonLd, { tournament: fixture }));
    const payload = extractJsonLdPayload(html);
    const offers = payload.offers as Record<string, unknown> | undefined;
    expect(offers).toBeDefined();
    const expectedDollars = fixture.buyInCents / 100;
    const priceNum =
      typeof offers!.price === 'number'
        ? (offers!.price as number)
        : Number.parseFloat(offers!.price as string);
    expect(priceNum).toBe(expectedDollars);
  });

  it('location.address contains the venue street address', () => {
    const html = renderToString(React.createElement(EventJsonLd, { tournament: fixture }));
    const payload = extractJsonLdPayload(html);
    const location = payload.location as Record<string, unknown> | undefined;
    expect(location).toBeDefined();
    expect(location).toHaveProperty('address');
    const addressSerialised = JSON.stringify(location!.address);
    expect(addressSerialised).toContain('16525 North Fwy');
  });

  it('maximumAttendeeCapacity matches the fixture capacity', () => {
    const html = renderToString(React.createElement(EventJsonLd, { tournament: fixture }));
    const payload = extractJsonLdPayload(html);
    expect(payload.maximumAttendeeCapacity).toBe(fixture.capacity);
  });
});
