/**
 * Site audit 2026-05-15, P0 item #2: /login page styling.
 *
 * Login currently renders bare HTML. Mirror /signup's structure:
 *  - centered narrow container (`maxWidth`)
 *  - eyebrow + display-font `<h1>` header block
 *  - styled `<label>`s with eyebrow spans
 *  - inputs with consistent padding/font-size
 *  - gold primary submit button (`className="btn btn-primary btn-lg"`)
 *
 * Source-grep contract (no Next.js runtime mount required, mirrors
 * tests/auth/auth-layout.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const LOGIN_PAGE = path.resolve(__dirname, '..', '..', 'app', '(auth)', 'login', 'page.tsx');

describe('/login page styling (audit P0 #2)', () => {
  const src = readFileSync(LOGIN_PAGE, 'utf8');

  it('uses the eyebrow class somewhere in the page (header block)', () => {
    expect(src).toMatch(/className=["']eyebrow["']/);
  });

  it('renders the gold primary button class on the submit', () => {
    expect(src).toMatch(/className=["']btn btn-primary btn-lg["']/);
  });

  it('declares a Cormorant Garamond display heading', () => {
    expect(src).toMatch(/Cormorant Garamond/);
  });

  it('still includes the email and password inputs', () => {
    expect(src).toMatch(/name=["']email["']/);
    expect(src).toMatch(/name=["']password["']/);
  });

  it('still includes the forgot-password and signup links', () => {
    expect(src).toMatch(/href=["']\/forgot-password["']/);
    expect(src).toMatch(/href=["']\/signup["']/);
  });

  it('forwards the optional ?next= query param as a hidden input', () => {
    // Functional requirement preserved from the original page.
    expect(src).toMatch(/name=["']next["']/);
  });
});
