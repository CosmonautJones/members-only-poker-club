/**
 * AC4 / T5 — `app/robots.ts` must allow `/` and disallow `/admin`,
 * `/cashier`, `/dashboard`, `/api`, while leaving every Slice-1 marketing
 * route crawlable.
 */

import { describe, expect, it } from 'vitest';
import robots from '@/app/robots';

describe('app/robots.ts (AC4 / T5)', () => {
  const config = robots();

  it('returns an object with a `rules` array', () => {
    expect(config).toBeTypeOf('object');
    expect(config).not.toBeNull();
    expect(Array.isArray((config as { rules?: unknown }).rules)).toBe(true);
    expect((config as { rules: unknown[] }).rules.length).toBeGreaterThan(0);
  });

  const firstRule = () => {
    const rules = (config as { rules: Array<Record<string, unknown>> }).rules;
    return rules[0]!;
  };

  const toArray = (value: unknown): string[] => {
    if (Array.isArray(value)) return value as string[];
    if (typeof value === 'string') return [value];
    return [];
  };

  it("first rule's `disallow` array contains exactly the protected prefixes", () => {
    const disallow = toArray(firstRule().disallow);
    expect(disallow).toEqual(
      expect.arrayContaining(['/admin', '/cashier', '/dashboard', '/api']),
    );
    // Exact-set check: the four entries above and nothing else for Slice 1.
    const sorted = [...disallow].sort();
    expect(sorted).toEqual(['/admin', '/api', '/cashier', '/dashboard']);
  });

  it("first rule's `allow` array includes `/`", () => {
    const allow = toArray(firstRule().allow);
    expect(allow).toContain('/');
  });

  it('returns a `sitemap` field (string)', () => {
    const sitemap = (config as { sitemap?: unknown }).sitemap;
    expect(typeof sitemap).toBe('string');
    expect((sitemap as string).length).toBeGreaterThan(0);
  });

  it('does not disallow any Slice-1 marketing route', () => {
    const disallow = toArray(firstRule().disallow);
    const marketingRoutes = ['/club', '/games', '/membership', '/contact', '/faq'];
    for (const route of marketingRoutes) {
      expect(disallow).not.toContain(route);
    }
  });
});
