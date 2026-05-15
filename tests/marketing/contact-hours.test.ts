/**
 * Site audit 2026-05-15, P1 item #6: /contact missing hours table.
 *
 * The footer "Hours" link routes to /contact but /contact only shows the
 * address. Add the hours block to /contact so the link is not a dead end.
 *
 * Asserts the canonical day strings appear in the contact page source,
 * mirroring the home page's HOURS_ROWS shape.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const CONTACT = path.resolve(__dirname, '..', '..', 'app', '(marketing)', 'contact', 'page.tsx');

describe('/contact hours block (audit P1 #6)', () => {
  const src = readFileSync(CONTACT, 'utf8');

  it.each(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])(
    'lists %s in the hours table',
    (day) => {
      expect(src).toContain(day);
    },
  );

  it('includes the "Hours" or "Open Tonight" eyebrow label', () => {
    expect(src).toMatch(/(Hours|Open Tonight)/);
  });

  it('still renders the address (existing content preserved)', () => {
    expect(src).toMatch(/streetAddress|address/);
  });
});
