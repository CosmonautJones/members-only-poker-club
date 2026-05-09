import { describe, it, expect } from 'vitest';
import { canonicalHash, canonicalText, shortSignature } from './canonical-hash';

const ADR_BODY = [
  '# ADR-0099: Test Decision',
  '',
  '- **Status:** Stub',
  '- **Date:** 2026-05-09',
  '- **Slice:** 3',
  '',
  '## Context',
  '',
  'We need a thing.',
  '',
  '## Direction',
  '',
  'Use the thing.',
  '',
].join('\n');

const withFrontmatter = (body: string, fm: Record<string, string>): string => {
  const lines = ['---', ...Object.entries(fm).map(([k, v]) => `${k}: ${v}`), '---', body];
  return lines.join('\n');
};

describe('canonicalHash', () => {
  it('produces a 64-char hex sha256', () => {
    const h = canonicalHash(ADR_BODY);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across whitespace-only edits (trailing spaces, blank-line runs)', () => {
    const a = ADR_BODY;
    const b = ADR_BODY.replace('We need a thing.', 'We need a thing.   ').replace(
      /\n\n## Direction/,
      '\n\n\n\n## Direction',
    );
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  it('is stable when frontmatter Ratified or content_signature is added (v0.3 the central guarantee)', () => {
    const stub = withFrontmatter(ADR_BODY, { name: 'adr-0099', description: 'test' });
    const ratified = withFrontmatter(ADR_BODY, {
      name: 'adr-0099',
      description: 'test',
      Ratified: '2026-05-09',
      content_signature: 'abc123def456',
    });
    expect(canonicalHash(stub)).toBe(canonicalHash(ratified));
  });

  it('still hashes Status and Slice (those ARE substantive)', () => {
    const a = withFrontmatter(ADR_BODY, { Status: 'Stub', Slice: '3' });
    const b = withFrontmatter(ADR_BODY, { Status: 'Accepted', Slice: '3' });
    expect(canonicalHash(a)).not.toBe(canonicalHash(b));
  });

  it('changes when substantive prose changes', () => {
    const a = ADR_BODY;
    const b = ADR_BODY.replace('We need a thing.', 'We need a different thing entirely.');
    expect(canonicalHash(a)).not.toBe(canonicalHash(b));
  });

  it('produces canonical text that ends with exactly one newline', () => {
    expect(canonicalText(ADR_BODY).endsWith('\n')).toBe(true);
    expect(canonicalText(ADR_BODY).endsWith('\n\n')).toBe(false);
  });

  it('shortSignature returns a 12-char prefix', () => {
    const h = canonicalHash(ADR_BODY);
    expect(shortSignature(h)).toBe(h.slice(0, 12));
    expect(shortSignature(h)).toHaveLength(12);
  });
});
