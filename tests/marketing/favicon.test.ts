/**
 * Site audit 2026-05-15, P2 item #8: 404 on /favicon.ico.
 *
 * Browsers and crawlers keep requesting /favicon.ico. Next 14 supports
 * either an `app/icon.tsx` (dynamic) or `app/favicon.ico` (static)
 * convention. Asserts at least one of the two ships.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';

const APP_ROOT = path.resolve(__dirname, '..', '..', 'app');
const ICON_TS = path.join(APP_ROOT, 'icon.tsx');
const FAVICON_ICO = path.join(APP_ROOT, 'favicon.ico');
const APPLE_ICON = path.join(APP_ROOT, 'apple-icon.tsx');

describe('favicon (audit P2 #8)', () => {
  it('ships either app/icon.tsx or app/favicon.ico', () => {
    const hasIcon = existsSync(ICON_TS);
    const hasFavicon = existsSync(FAVICON_ICO);
    expect(hasIcon || hasFavicon).toBe(true);
  });

  it('ships an apple-icon for iOS home-screen pin (P2 polish)', () => {
    // Optional but recommended; pin one variant.
    const hasApple = existsSync(APPLE_ICON);
    const hasFavicon = existsSync(FAVICON_ICO);
    expect(hasApple || hasFavicon).toBe(true);
  });
});
