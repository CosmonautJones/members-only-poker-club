// TODO(travis): legal review before public launch — mirrors the
//   ADR-0024 cookie-banner copy posture. Engineering-authored
//   placeholder. Counsel must review and approve before the club
//   opens to the public.

/**
 * Privacy Policy module — ADR-0023 slice 1, AC6.
 *
 * Pure React component — no Server-Component data fetching, no client hooks.
 * Versioned in the codebase so the policy can be re-rendered identically
 * from anywhere (privacy page, future signup-flow modal, etc.).
 */

/**
 * The ISO date this version of the policy became effective.
 * Update this constant whenever material changes are made.
 */
export const PRIVACY_POLICY_VERSION = '2026-05-14' as const;

/**
 * Human-readable effective date displayed in the page header.
 * Kept in sync with PRIVACY_POLICY_VERSION.
 */
export const PRIVACY_POLICY_EFFECTIVE_DATE = '2026-05-14' as const;

/**
 * Plain-language privacy policy for Members Only Poker Social Club.
 *
 * Content mirrors ADR-0023's "Categories of data" / "Member-initiated rights"
 * / "Retention schedule" sections. No marketing-speak; minimal legal jargon.
 * Financial-records retention is stated explicitly so members understand
 * that deleting their account does not erase ledger / payment history
 * (legal exception per CCPA / IRS).
 */
export default function PrivacyPolicy(): JSX.Element {
  return (
    <>
      <h2>What we collect</h2>
      <p>
        When you become a member we collect your name, date of birth, email address, and phone
        number. We also collect an ID document image to verify your age and identity; that image is
        deleted 30 days after verification is complete. When you use the site we collect session
        data, page views, and any JavaScript errors that occur in your browser.
      </p>
      <p>
        When you make payments we record the Stripe customer ID and payment-intent IDs associated
        with your account, and we keep a ledger of your transactions with the club.
      </p>

      <h2>How we use it</h2>
      <p>
        We use your information to operate the club: to verify your identity, manage your
        membership, process buy-ins and cashouts, and send you messages about your account. We use
        session and error data to keep the site running correctly. We use analytics to understand
        how the site is used so we can improve it.
      </p>
      <p>
        We do <strong>not</strong> sell your personal information to third parties.
      </p>

      <h2>Who sees it</h2>
      <p>
        Club staff (cashiers and managers) can see your name, email, and role so they can assist
        you at the table. Only managers and above can see soft-deleted or anonymized account records
        for compliance purposes. We share data with our service providers — Supabase (database and
        authentication), Stripe (payments), Sentry (error tracking), and PostHog (analytics) — only
        as necessary to operate the club.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Different types of data have different retention schedules:
      </p>
      <ul>
        <li>
          <strong>ID document image:</strong> Deleted 30 days after your identity is verified.
        </li>
        <li>
          <strong>Audit log:</strong> Kept forever for compliance and dispute resolution.
        </li>
        <li>
          <strong>Financial records (ledger and payments):</strong> Retained for at least 7 years
          per IRS and tax requirements. <strong>Requesting deletion of your account does not
          remove your financial history.</strong> This is a legal exception under CCPA and
          applicable tax law.
        </li>
        <li>
          <strong>Error tracking (Sentry):</strong> 90 days.
        </li>
        <li>
          <strong>Analytics (PostHog):</strong> 1 year.
        </li>
        <li>
          <strong>Sessions:</strong> 30 days for security forensics.
        </li>
        <li>
          <strong>Marketing contacts:</strong> Until you unsubscribe.
        </li>
      </ul>

      <h2>Your rights</h2>
      <p>
        You have the right to access, correct, and delete your personal information. You can
        exercise these rights from the{' '}
        <a href="/profile/privacy">Privacy &amp; data</a> section of your profile:
      </p>
      <ul>
        <li>
          <strong>Download my data:</strong> Get a JSON export of your profile and audit history.
        </li>
        <li>
          <strong>Delete my account:</strong> Anonymizes your name, email, and phone number and
          signs you out. Financial and audit records are retained as described above. This action
          cannot be undone.
        </li>
        <li>
          <strong>Correct your information:</strong> You can edit your profile fields directly. For
          changes to immutable fields (date of birth, member number), contact a manager.
        </li>
        <li>
          <strong>Opt out of data sale:</strong> We do not sell your personal data. The opt-out
          toggle is present as required by CCPA but has no operational effect.
        </li>
      </ul>
      <p>
        To exercise rights that are not available self-serve, email us at the address in the
        Contact section below.
      </p>

      <h2>Cookies &amp; tracking</h2>
      <p>
        We use cookies to keep you signed in (essential) and, with your consent, to collect
        analytics data and error reports. You can manage your cookie preferences from the cookie
        banner that appears when you first visit the site, or by clearing your browser cookies at
        any time. For full details see our{' '}
        <a href="/privacy#cookies">cookie policy section</a>.
      </p>

      <h2>Children</h2>
      <p>
        This site is for adults only. We do not knowingly collect personal information from anyone
        under the age of 21. If you believe a minor has provided us with personal information,
        contact us and we will delete it promptly.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        We will update this page when our data practices change. The effective date at the top of
        the page tells you when the current version took effect. Material changes will be
        communicated to members by email before they take effect.
      </p>

      <h2>Contact us</h2>
      <p>
        Questions about this privacy policy or your personal data? Contact the club through the
        member portal or by emailing the address on file for your membership. We aim to respond
        within 30 days.
      </p>
    </>
  );
}
