/**
 * Tests for the privacy policy page and component — ADR-0023 AC6.
 *
 * Sub-cases:
 *   1. PrivacyPolicy renders all 9 required section headings.
 *   2. PRIVACY_POLICY_VERSION is exported and matches YYYY-MM-DD format.
 *   3. PRIVACY_POLICY_EFFECTIVE_DATE is exported and matches YYYY-MM-DD format.
 *   4. The page-level component renders the version string and delegates body to PrivacyPolicy.
 *   5. Source-grep: lib/legal/privacy-policy.tsx contains the TODO(travis) legal-review comment.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import PrivacyPolicy, {
  PRIVACY_POLICY_VERSION,
  PRIVACY_POLICY_EFFECTIVE_DATE,
} from '@/lib/legal/privacy-policy';
import Page from '@/app/(marketing)/privacy/page';

const POLICY_SRC_PATH = resolve(__dirname, '../../lib/legal/privacy-policy.tsx');

describe('PrivacyPolicy component — 9 required section headings', () => {
  const EXPECTED_HEADINGS = [
    'What we collect',
    'How we use it',
    'Who sees it',
    'How long we keep it',
    'Your rights',
    'Cookies & tracking',
    'Children',
    'Changes to this policy',
    'Contact us',
  ];

  it.each(EXPECTED_HEADINGS)('renders h2: "%s"', (heading) => {
    render(<PrivacyPolicy />);
    const el = screen.getByRole('heading', { level: 2, name: new RegExp(`^${heading}$`, 'i') });
    expect(el).toBeTruthy();
  });
});

describe('PRIVACY_POLICY_VERSION and PRIVACY_POLICY_EFFECTIVE_DATE exports', () => {
  it('PRIVACY_POLICY_VERSION is a non-empty string in YYYY-MM-DD format', () => {
    expect(typeof PRIVACY_POLICY_VERSION).toBe('string');
    expect(PRIVACY_POLICY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('PRIVACY_POLICY_EFFECTIVE_DATE is a non-empty string in YYYY-MM-DD format', () => {
    expect(typeof PRIVACY_POLICY_EFFECTIVE_DATE).toBe('string');
    expect(PRIVACY_POLICY_EFFECTIVE_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('Privacy page', () => {
  it('renders the policy version string in the page', () => {
    render(<Page />);
    // Page must display the version string somewhere on the page.
    const versionText = screen.getByText(new RegExp(PRIVACY_POLICY_VERSION));
    expect(versionText).toBeTruthy();
  });

  it('renders at least one h2 heading from PrivacyPolicy (delegates to component)', () => {
    render(<Page />);
    // PrivacyPolicy renders h2 headings — the page must include them.
    const h2s = screen.getAllByRole('heading', { level: 2 });
    expect(h2s.length).toBeGreaterThanOrEqual(1);
  });
});

describe('policy source assertions', () => {
  it('lib/legal/privacy-policy.tsx contains the TODO(travis): legal review comment', () => {
    const source = readFileSync(POLICY_SRC_PATH, 'utf8');
    expect(source).toMatch(/TODO\(travis\):\s+legal review/i);
  });

  it('financial records retention (legal exception) is mentioned in the policy text', () => {
    // AC6 requires the policy to explicitly state that financial records
    // are retained per legal exception so members understand the delete
    // action does not erase their payment history.
    const source = readFileSync(POLICY_SRC_PATH, 'utf8');
    expect(source).toMatch(/financial/i);
    expect(source).toMatch(/retain/i);
    expect(source).toMatch(/legal/i);
  });
});
