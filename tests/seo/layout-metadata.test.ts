/**
 * AC1 / T1 — Marketing layout metadata defaults.
 *
 * Asserts that `app/(marketing)/layout.tsx` exports a `metadata` object that
 * supplies sensible defaults (title, description, openGraph, twitter card)
 * for every page that does not provide its own override.
 *
 * The root `app/layout.tsx` already sets `metadataBase`; this test only
 * validates the marketing-group-specific defaults.
 */

import { describe, expect, it } from 'vitest';
import * as marketingLayout from '@/app/(marketing)/layout';

describe('marketing layout metadata (AC1 / T1)', () => {
  it('exports a `metadata` object', () => {
    expect(marketingLayout).toHaveProperty('metadata');
    expect(marketingLayout.metadata).toBeTypeOf('object');
    expect(marketingLayout.metadata).not.toBeNull();
  });

  it('defines a `title` that is either a string or has a `template` field', () => {
    const { metadata } = marketingLayout as { metadata: Record<string, unknown> };
    const title = metadata.title;
    expect(title).toBeDefined();

    if (typeof title === 'string') {
      expect(title.length).toBeGreaterThan(0);
    } else {
      expect(title).toBeTypeOf('object');
      expect(title).toHaveProperty('template');
      const t = title as { template?: unknown };
      expect(typeof t.template === 'string' && t.template.length > 0).toBe(true);
    }
  });

  it('defines a non-empty `description`', () => {
    const { metadata } = marketingLayout as { metadata: { description?: unknown } };
    expect(typeof metadata.description).toBe('string');
    expect((metadata.description as string).trim().length).toBeGreaterThan(0);
  });

  it('defines `openGraph` with title, description, type, and images', () => {
    const { metadata } = marketingLayout as {
      metadata: { openGraph?: Record<string, unknown> };
    };
    expect(metadata.openGraph).toBeDefined();
    const og = metadata.openGraph as Record<string, unknown>;
    expect(og).toHaveProperty('title');
    expect(og).toHaveProperty('description');
    expect(og).toHaveProperty('type');
    expect(og).toHaveProperty('images');
  });

  it('defines `twitter.card` equal to "summary_large_image"', () => {
    const { metadata } = marketingLayout as {
      metadata: { twitter?: Record<string, unknown> };
    };
    expect(metadata.twitter).toBeDefined();
    const twitter = metadata.twitter as Record<string, unknown>;
    expect(twitter.card).toBe('summary_large_image');
  });
});
