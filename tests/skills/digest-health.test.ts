/**
 * Tests for scripts/run-tools/digest-health.mjs — mechanical health-metric
 * computation for /digest.
 *
 * Pins the contract that /digest's "health metric" prose claim is now a
 * callable function: read inbox/, classify processed entries, report ratio.
 *
 * Run locally:    pnpm test tests/skills/digest-health.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
// @ts-expect-error — .mjs has no .d.ts; we exercise the exports at runtime
import {
  parseFrontmatter,
  classify,
  computeHealth,
} from '../../scripts/run-tools/digest-health.mjs';

// Per-test sandbox directory so tests don't trample the real inbox.
const SANDBOX = resolve(process.cwd(), 'tests/skills/.digest-health-sandbox');

function writeEntry(name: string, frontmatter: Record<string, string>, body = '') {
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  writeFileSync(join(SANDBOX, name), `---\n${fm}\n---\n\n${body}\n`, 'utf8');
}

beforeEach(() => {
  if (existsSync(SANDBOX)) rmSync(SANDBOX, { recursive: true, force: true });
  mkdirSync(SANDBOX, { recursive: true });
});

afterEach(() => {
  if (existsSync(SANDBOX)) rmSync(SANDBOX, { recursive: true, force: true });
});

describe('parseFrontmatter', () => {
  it('extracts simple key:value pairs', () => {
    const fm = parseFrontmatter('---\nkind: manual\nstatus: processed\n---\n\nbody');
    expect(fm).toEqual({ kind: 'manual', status: 'processed' });
  });

  it('returns null on missing frontmatter', () => {
    expect(parseFrontmatter('no frontmatter here')).toBeNull();
  });

  it('handles values containing colons and slashes', () => {
    const fm = parseFrontmatter(
      '---\nprocessed_into: scripts/run-tools/ship.sh: tightened signature\n---',
    );
    expect(fm).not.toBeNull();
    expect(fm.processed_into).toBe('scripts/run-tools/ship.sh: tightened signature');
  });
});

describe('classify', () => {
  it('returns "unknown" for empty input', () => {
    expect(classify('')).toBe('unknown');
    expect(classify(undefined as unknown as string)).toBe('unknown');
  });

  it('detects drop status (starts with "drop")', () => {
    expect(classify('drop: false positive')).toBe('drop');
    expect(classify('DROP: superseded')).toBe('drop');
  });

  it('detects surface status', () => {
    expect(classify('surfaced to user as separate proposal')).toBe('surface');
    expect(classify('Surface to user — decision pending')).toBe('surface');
  });

  it('classifies new-test from tests/ path', () => {
    expect(classify('tests/skills/run-hooks-parsing.test.ts (9-test suite)')).toBe('new-test');
  });

  it('classifies new-tool from scripts/ path', () => {
    expect(classify('scripts/run-tools/ship.sh (tightened commit signature)')).toBe('new-tool');
  });

  it('classifies new-skill from .claude/skills/ path', () => {
    expect(classify('.claude/skills/foo-audit/SKILL.md (new sharp-trigger skill)')).toBe(
      'new-skill',
    );
  });

  it('classifies kb-archive from docs/kb/ path', () => {
    expect(classify('docs/kb/pglite.md (appended dated bullet)')).toBe('kb-archive');
  });

  it('uses text-position priority when multiple categories match', () => {
    // scripts/ appears FIRST → new-tool wins over the later .claude/skills/ mention
    expect(
      classify('scripts/run-tools/ship.sh (primary) + .claude/skills/run/SKILL.md (doc amendment)'),
    ).toBe('new-tool');

    // .claude/skills/ appears FIRST → new-skill wins
    expect(
      classify('.claude/skills/new-skill/SKILL.md (primary) + scripts/example.sh (referenced)'),
    ).toBe('new-skill');
  });

  it('drop takes priority over path mentions', () => {
    // Even if "scripts/" is in the reason, "drop:" prefix wins
    expect(classify('drop: superseded by scripts/run-tools/foo.sh in PR #99')).toBe('drop');
  });

  it('surface takes priority over path mentions', () => {
    expect(
      classify('surfaced to user — decision pending on .claude/skills/run/SKILL.md amendment'),
    ).toBe('surface');
  });
});

describe('computeHealth', () => {
  it('returns zero counts and null ratio for empty inbox', () => {
    const result = computeHealth(SANDBOX);
    expect(result.total_processed).toBe(0);
    expect(result.binding_ratio).toBeNull();
    expect(result.healthy).toBeNull();
    expect(result.by_category).toEqual({
      'new-test': 0,
      'new-tool': 0,
      'new-skill': 0,
      'kb-archive': 0,
      drop: 0,
      surface: 0,
      unknown: 0,
    });
  });

  it('ignores unprocessed entries', () => {
    writeEntry('a.md', { status: 'unprocessed' });
    writeEntry('b.md', { status: 'unprocessed' });
    const result = computeHealth(SANDBOX);
    expect(result.total_processed).toBe(0);
  });

  it('classifies a mixed-category inbox and computes ratio correctly', () => {
    writeEntry('a.md', { status: 'processed', processed_into: 'tests/skills/foo.test.ts' });
    writeEntry('b.md', { status: 'processed', processed_into: 'scripts/run-tools/bar.sh' });
    writeEntry('c.md', { status: 'processed', processed_into: '.claude/skills/baz/SKILL.md' });
    writeEntry('d.md', { status: 'processed', processed_into: 'docs/kb/qux.md' });
    writeEntry('e.md', { status: 'processed', processed_into: 'drop: false positive' });
    writeEntry('f.md', { status: 'processed', processed_into: 'surfaced to user' });

    const result = computeHealth(SANDBOX);

    expect(result.total_processed).toBe(6);
    expect(result.by_category).toEqual({
      'new-test': 1,
      'new-tool': 1,
      'new-skill': 1,
      'kb-archive': 1,
      drop: 1,
      surface: 1,
      unknown: 0,
    });

    // numerator = test + tool = 2
    // denominator = total - drop - surface = 6 - 1 - 1 = 4
    expect(result.binding_numerator).toBe(2);
    expect(result.binding_denominator).toBe(4);
    expect(result.binding_ratio).toBe(0.5);
    expect(result.healthy).toBe(false); // strict >0.5, equal counts as unhealthy
  });

  it('reports healthy=true when ratio > 0.5', () => {
    writeEntry('a.md', { status: 'processed', processed_into: 'tests/foo.test.ts' });
    writeEntry('b.md', { status: 'processed', processed_into: 'scripts/bar.sh' });
    writeEntry('c.md', { status: 'processed', processed_into: '.claude/skills/baz/SKILL.md' });

    const result = computeHealth(SANDBOX);
    expect(result.binding_ratio).toBeCloseTo(2 / 3, 5);
    expect(result.healthy).toBe(true);
  });

  it('healthy=null when all entries are drop/surface (no opinion)', () => {
    writeEntry('a.md', { status: 'processed', processed_into: 'drop: not a real issue' });
    writeEntry('b.md', { status: 'processed', processed_into: 'surfaced to user' });

    const result = computeHealth(SANDBOX);
    expect(result.binding_denominator).toBe(0);
    expect(result.binding_ratio).toBeNull();
    expect(result.healthy).toBeNull();
  });

  it('classifies "unknown" when processed_into has no recognizable pattern', () => {
    writeEntry('a.md', { status: 'processed', processed_into: 'something opaque' });
    const result = computeHealth(SANDBOX);
    expect(result.by_category.unknown).toBe(1);
    expect(result.total_processed).toBe(1);
  });
});
