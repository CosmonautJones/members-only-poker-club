/**
 * ADR-0015 alerting-docs cross-consistency tests.
 *
 * Verifies the docs surface is wired correctly. Source-grep based — no
 * markdown rendering required.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..');

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8');
}

describe('docs/ops/alerting.md', () => {
  const source = read('docs/ops/alerting.md');

  it('declares all three severity tiers', () => {
    expect(source).toMatch(/SEV1/);
    expect(source).toMatch(/SEV2/);
    expect(source).toMatch(/SEV3/);
  });

  it('lists every alert source enumerated in ADR-0015', () => {
    expect(source).toMatch(/Sentry/);
    expect(source).toMatch(/Vercel/);
    expect(source).toMatch(/Supabase/);
    expect(source).toMatch(/Stripe/);
    expect(source).toMatch(/[Ss]ynthetic uptime/);
  });

  it('declares the on-call posture for v1', () => {
    expect(source).toMatch(/[Oo]n-call/);
    expect(source).toMatch(/owner/i);
  });

  it('explicitly names PagerDuty as declined for v1', () => {
    expect(source).toMatch(/PagerDuty.*declined/i);
  });

  it('cross-links the runbook and the postmortem template', () => {
    expect(source).toMatch(/runbook-incident-response/);
    expect(source).toMatch(/incidents\/_template/);
  });
});

describe('docs/runbooks/runbook-incident-response.md', () => {
  const source = read('docs/runbooks/runbook-incident-response.md');

  it('contains the six numbered steps', () => {
    for (const i of [0, 1, 2, 3, 4, 5, 6]) {
      expect(source, `step ${i} missing`).toMatch(new RegExp(`Step ${i}`));
    }
  });

  it('mentions the cheapest first move (rollback)', () => {
    expect(source).toMatch(/rollback/i);
  });

  it('cross-links the alerting doc and postmortem template', () => {
    expect(source).toMatch(/ops\/alerting\.md/);
    expect(source).toMatch(/incidents\/_template/);
  });
});

describe('docs/incidents/_template.md', () => {
  const source = read('docs/incidents/_template.md');

  it('contains every required section', () => {
    for (const heading of [
      '## Summary',
      '## Timeline',
      '## Impact',
      '## Root cause',
      '## What worked',
      "## What didn't",
      '## Action items',
      '## Lessons',
      '## References',
    ]) {
      expect(source, `missing: ${heading}`).toContain(heading);
    }
  });

  it('declares severity, date, on-call, and postmortem-owner front-matter slots', () => {
    expect(source).toMatch(/\*\*Severity:\*\*/);
    expect(source).toMatch(/\*\*Date:\*\*/);
    expect(source).toMatch(/\*\*On-call:\*\*/);
    expect(source).toMatch(/\*\*Postmortem owner:\*\*/);
  });
});
