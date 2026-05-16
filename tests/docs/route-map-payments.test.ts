// Documentation drift test — ADR-0036 / AC32.
//
// Creates the `tests/docs/` test category (per ADR-0036 Open Q5). Future
// documentation-drift tests (ADR-table verifications, route-map vs filesystem
// reconciliation, etc.) belong in this directory.
//
// What this test guards
// ---------------------
//
// 1. Both new Slice-1 staff rows are present in docs/route-map.md:
//    - `/admin/payments` (manager+, ADRs 010 011 022 027 036)
//    - `/admin/payments/refunds/new` (manager+, ADRs 010 022 027 036)
//
// 2. The legacy `/admin/refunds` row no longer appears as an active (non
//    strikethrough) entry — superseded by the `/admin/payments/**` tree per
//    ADR-0036 Slice 1.
//
// 3. The footnote beneath the Staff table records that the full ADR-0036
//    surface lands in Slices 2-5 of ADR-0036, gated on Stripe activation per
//    ADR-0010.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename_safe =
  typeof __dirname === 'undefined'
    ? fileURLToPath(import.meta.url)
    : `${__dirname}/__placeholder__`;
const TEST_DIR = typeof __dirname === 'undefined' ? dirname(__filename_safe) : __dirname;
const ROUTE_MAP_PATH = resolve(TEST_DIR, '..', '..', 'docs', 'route-map.md');
const ROUTE_MAP = readFileSync(ROUTE_MAP_PATH, 'utf8');

describe('docs/route-map.md — ADR-0036 Slice 1 amendments (AC32)', () => {
  it('declares the `/admin/payments` staff row gated to manager+ citing ADRs 010, 011, 022, 027, 036', () => {
    // Row form: `| — | \`/admin/payments\` | ... | manager+ | 010, 011, 022, 027, 036 |`
    // Em-dash leading cell + backticked path + manager+ gate + the five
    // ADR cites in order. Tolerate whitespace.
    const row =
      /\|\s*—\s*\|\s*`\/admin\/payments`\s*\|[^|]*\|\s*manager\+\s*\|\s*010,\s*011,\s*022,\s*027,\s*036\s*\|/;
    expect(ROUTE_MAP).toMatch(row);
  });

  it('declares the `/admin/payments/refunds/new` staff row gated to manager+ citing ADRs 010, 022, 027, 036', () => {
    const row =
      /\|\s*—\s*\|\s*`\/admin\/payments\/refunds\/new`\s*\|[^|]*\|\s*manager\+\s*\|\s*010,\s*022,\s*027,\s*036\s*\|/;
    expect(ROUTE_MAP).toMatch(row);
  });

  it('the `/admin/payments/refunds/new` cell records the fail-loud + ADR-0010 Stripe activation gating', () => {
    const idx = ROUTE_MAP.search(/`\/admin\/payments\/refunds\/new`/);
    expect(idx).toBeGreaterThanOrEqual(0);
    // Pick the row containing the path; assert the description column cites
    // ADR-0036 Slice 1 + the fail-loud-until-ADR-0010 gating.
    const lineEnd = ROUTE_MAP.indexOf('\n', idx);
    const rowText = ROUTE_MAP.slice(idx, lineEnd === -1 ? undefined : lineEnd);
    expect(rowText).toMatch(/ADR-0036\s+Slice\s+1/i);
    expect(rowText).toMatch(/fail-loud/i);
    expect(rowText).toMatch(/ADR-0010/);
  });

  it('the legacy `/admin/refunds` row no longer appears as an active (non-strikethrough) table row', () => {
    // The legacy row shape was:
    //   `| — | \`/admin/refunds\` | (new — Slice 4) | manager+ | 010, 011, 027 |`
    // Tolerate either complete absence OR a strikethrough form
    // (`| ~~/admin/refunds~~ |`). The active form must NOT match.
    const activeRow = /\|\s*—\s*\|\s*`\/admin\/refunds`\s*\|/;
    if (activeRow.test(ROUTE_MAP)) {
      // Allow only if the surrounding span is a tilde-strikethrough — i.e.
      // `~~/admin/refunds~~` or similar. The active backticked row must not
      // appear standalone.
      const hits = ROUTE_MAP.match(activeRow);
      throw new Error(
        `Legacy active row \`/admin/refunds\` still present in docs/route-map.md (match: ${hits?.[0]}). It must be replaced by the /admin/payments/** tree per ADR-0036 Slice 1.`,
      );
    }
  });

  it('the footnote beneath the Staff table records the full ADR-0036 surface lands in Slices 2–5', () => {
    // Footnote uses an en-dash between 2 and 5 ("Slices 2–5"). Match
    // either an en-dash (–) or a plain hyphen between the digits to
    // stay tolerant to editor normalization.
    expect(ROUTE_MAP).toMatch(/Slices\s+2[–-]5\s+of\s+ADR-0036/);
  });

  it('the footnote cites ADR-0010 Stripe activation as the gating condition', () => {
    // Pull a window around the "Slices 2–5" text and assert ADR-0010 is
    // referenced as the activation gate. The footnote is the only place in
    // the file that should mention ADR-0010 Stripe activation in this form.
    const idx = ROUTE_MAP.search(/Slices\s+2[–-]5\s+of\s+ADR-0036/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const block = ROUTE_MAP.slice(Math.max(0, idx - 200), idx + 600);
    expect(block).toMatch(/ADR-0010/);
    // And explicitly records that the legacy `/admin/refunds` row is
    // superseded by the /admin/payments/** tree.
    expect(block).toMatch(/`\/admin\/refunds`/);
    expect(block).toMatch(/`\/admin\/payments\/\*\*`/);
  });
});
