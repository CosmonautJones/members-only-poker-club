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

  // Bullet-style frontmatter is the in-repo ADR convention (also common in
  // many ADR templates). The original v0.3 implementation only stripped YAML
  // `---` frontmatter, so a `- **content_signature:** <hash>` bullet in the
  // body made the hash recursive (depend on itself). These tests guard against
  // regressing that fix.
  it('is stable when bullet-style content_signature value changes (the recursive-hash bug)', () => {
    const a = ADR_BODY.replace(
      '- **Slice:** 3',
      '- **Slice:** 3\n- **content_signature:** PENDING',
    );
    const b = ADR_BODY.replace(
      '- **Slice:** 3',
      '- **Slice:** 3\n- **content_signature:** abcdef123456',
    );
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  it('is stable when bullet-style Ratified or Date changes', () => {
    const a = ADR_BODY.replace(
      '- **Date:** 2026-05-09',
      '- **Date:** 2026-05-09\n- **Ratified:** 2026-05-09',
    );
    const b = ADR_BODY.replace(
      '- **Date:** 2026-05-09',
      '- **Date:** 2026-05-10\n- **Ratified:** 2026-05-10',
    );
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  it('still hashes bullet-style Status and Slice (those ARE substantive)', () => {
    const a = ADR_BODY; // Status: Stub
    const b = ADR_BODY.replace('- **Status:** Stub', '- **Status:** Accepted');
    expect(canonicalHash(a)).not.toBe(canonicalHash(b));
  });

  it('still hashes bullet-style Supersedes / Superseded by (substantive lifecycle)', () => {
    const a = ADR_BODY;
    const b = ADR_BODY.replace(
      '- **Slice:** 3',
      '- **Slice:** 3\n- **Superseded by:** ADR-0099',
    );
    expect(canonicalHash(a)).not.toBe(canonicalHash(b));
  });

  it('only strips bullet-frontmatter between H1 and first H2 (body bullets are content)', () => {
    // A bullet INSIDE the body (after `## Context`) must not be treated as
    // frontmatter — even if it happens to match the pattern.
    const a = ADR_BODY;
    const b = ADR_BODY.replace(
      'We need a thing.',
      'We need a thing.\n\n- **Note:** important caveat',
    );
    expect(canonicalHash(a)).not.toBe(canonicalHash(b));
  });
});
