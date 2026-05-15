/**
 * Site audit 2026-05-15, P0 item #3: mobile hamburger nav.
 *
 * The public header was desktop-only — at 390px the right-side links
 * clipped off-screen. The fix adds a hamburger button (visible
 * md:hidden) that toggles a slide-down drawer containing every nav link
 * plus Member Sign In.
 *
 * Implementation note: the disclosure lives in a separate `'use client'`
 * island (`components/marketing/mobile-menu.tsx`) so the parent header
 * can stay a Server Component — the Chip SVG primitives use Math.cos /
 * Math.sin and hit float-precision SSR/client hydration mismatches when
 * rendered inside a client boundary.
 *
 * Pin both files together.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..', 'components', 'marketing');
const HEADER = path.join(ROOT, 'public-header.tsx');
const DRAWER = path.join(ROOT, 'mobile-menu.tsx');

describe('mobile hamburger nav (audit P0 #3)', () => {
  const headerSrc = readFileSync(HEADER, 'utf8');
  const drawerSrc = readFileSync(DRAWER, 'utf8');
  const combined = headerSrc + '\n' + drawerSrc;

  it('declares a hamburger button with aria-label "Open menu" (or similar)', () => {
    expect(combined).toMatch(/aria-label=["'](Open|Toggle|Main) menu["']/i);
  });

  it('uses the md:hidden / md:flex breakpoint pattern', () => {
    expect(combined).toMatch(/md:hidden/);
    expect(combined).toMatch(/md:flex/);
  });

  it('renders the Member Sign In control inside the mobile drawer', () => {
    // "Member Sign In" must appear at least twice across the two files
    // — once in the desktop nav row (header) and once in the mobile
    // drawer (mobile-menu).
    const occurrences = (combined.match(/Member Sign In/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it('marks the mobile drawer with a controlled-disclosure shape', () => {
    const hasUseState = /useState/.test(combined);
    const hasAriaExpanded = /aria-expanded/.test(combined);
    expect(hasUseState).toBe(true);
    expect(hasAriaExpanded).toBe(true);
  });
});
