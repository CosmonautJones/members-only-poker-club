/**
 * Source-grep invariants for the conductor SKILL.md v0.5 sentinel contract.
 *
 * Run locally:    pnpm test tests/skills/conductor-sentinels.test.ts
 * Prerequisites:  none — pure file-read; no DB, no network.
 *
 * Contract (per `.claude/skills/conductor/SKILL.md` §Goal Integration):
 *   - Every turn-ending response terminates with exactly one sentinel as
 *     its LAST LINE.
 *   - Three sentinels:
 *       * `GOAL-A: ADR-NNNN <slug> shipped — PR <url> — retrospective <path>`
 *       * `PING: <category> — <detail>`
 *       * `GOAL-C: phase=<P> task=<id> background=<N> resume=/conductor resume`
 *   - SEVEN PING categories: secrets | auth | money | ratification | stuck
 *     | destructive | learn.
 *
 * If SKILL.md drifts from this contract, this test fails and CI catches it
 * before a /conductor run wedges under /goal.
 *
 * Source: docs/kb/conductor-goal-integration.md §Verification.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SKILL_PATH = resolve(process.cwd(), '.claude/skills/conductor/SKILL.md');

describe('conductor SKILL.md v0.5 sentinel contract', () => {
  const src = readFileSync(SKILL_PATH, 'utf8');

  it('declares the §Goal Integration section', () => {
    expect(src).toMatch(/##\s+Goal Integration/);
  });

  it('declares the GOAL-A success sentinel shape', () => {
    expect(src).toMatch(/`GOAL-A: ADR-NNNN[^`]+shipped[^`]+PR[^`]+retrospective[^`]+`/i);
  });

  it('declares the GOAL-C turn-yield sentinel shape', () => {
    expect(src).toMatch(/`GOAL-C: phase=[^`]+task=[^`]+background=[^`]+resume=\/conductor resume`/);
  });

  it('declares the PING blocked-on-human sentinel shape', () => {
    expect(src).toMatch(/`PING: <category> — <detail>`/);
  });

  it.each(['secrets', 'auth', 'money', 'ratification', 'stuck', 'destructive', 'learn'])(
    'lists the `%s` PING category',
    (category) => {
      // Match a literal "- `<category>` — " line in the categories list. The
      // backtick form is the canonical category-marker per the §Goal
      // Integration section's bullet list.
      const re = new RegExp(`\`${category}\`\\s+—`);
      expect(src).toMatch(re);
    },
  );

  it('declares the v0.5 turn-boundary discipline (§Loop bounds)', () => {
    expect(src).toMatch(/##\s+Loop bounds[^\n]*v0\.5/);
    // Each retry iteration must be ITS OWN TURN — load-bearing prose
    // the test pins so a future drift back to sync loops fails CI.
    expect(src).toMatch(/each retry iteration is\s+\*\*?its own turn\*\*?/i);
  });

  it('declares the /conductor learn sub-command in §Self-improvement loops', () => {
    expect(src).toMatch(/\/conductor learn/);
    expect(src).toMatch(/Skill changelog \(auto-learn\)/);
  });

  it('declares the Mid-flight worker failure recovery section', () => {
    expect(src).toMatch(/##\s+Mid-flight worker failure recovery/);
  });

  it('declares the Finisher fold-in pattern in Phase 3', () => {
    expect(src).toMatch(/Finisher fold-in/);
    expect(src).toMatch(/worker.*role="finisher"/);
  });

  it('bumps version to v0.5 in the title', () => {
    expect(src).toMatch(/^#\s+Conductor[^\n]+v0\.5/m);
  });

  it('lists v0.5 as the current Changelog entry', () => {
    expect(src).toMatch(/##\s+Changelog[\s\S]*?-\s+\*\*v0\.5[^\n]*this version/);
  });
});
