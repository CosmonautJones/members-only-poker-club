/**
 * Owner bug report 2026-05-15: the /signup `<input type="date">` renders
 * its placeholder ("MM/DD/YYYY") and selected value in near-invisible
 * light gray on the form's white background. Other inputs render dark
 * text on white because the browser's light color scheme picks a
 * readable color; the date input picks up the page's dark color scheme
 * and inverts.
 *
 * Fix: force `colorScheme: 'light'` on the date input AND an explicit
 * dark `color` on the value text — covers both the browser-native date
 * picker chrome (placeholder, clear icon) and the typed value.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SIGNUP_PAGE = path.resolve(__dirname, '..', '..', 'app', '(auth)', 'signup', 'page.tsx');

describe('/signup date input readability (owner bug 2026-05-15)', () => {
  const src = readFileSync(SIGNUP_PAGE, 'utf8');

  it('forces the date input to render with light color-scheme', () => {
    // Browser-native <input type="date"> chrome inherits the page's
    // declared color-scheme. The marketing site declares a dark scheme,
    // so the date control inverts to dark-mode rendering — placeholder
    // becomes near-invisible against the white input background.
    // `color-scheme: light` overrides that locally.
    expect(src).toMatch(/colorScheme:\s*['"]light['"]/);
  });

  it('sets an explicit dark text color on the date input', () => {
    // Defense in depth: even with color-scheme, some browsers (Chrome
    // on certain platforms) need an explicit `color` on the value text.
    // The other inputs (name/email/password) get dark text from the
    // browser's light-mode default; the date input does not.
    // Accept either the dark var or a literal dark hex.
    const dobInputBlock = src.match(/type=["']date["'][^/]*\/>/);
    expect(dobInputBlock).not.toBeNull();
    const block = (dobInputBlock?.[0] ?? '') + '\n' + src;
    expect(block).toMatch(/color:\s*['"](#000|#0[Bb]0[Bb]0[Bb]|var\(--ink-9\d{2}\))['"]/);
  });
});
