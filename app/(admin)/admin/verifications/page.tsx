/**
 * `/admin/verifications` — ID-verification queue (ADR-0035 AC11, WB.T7).
 *
 * Server component. Backs the `manager+`-gated queue of ID document
 * uploads waiting for staff review. The shipping contract here is
 * **page + read path + action-button placeholders only** — the
 * Approve / Reject / Request more info server actions (AC12, AC13,
 * AC14) and the typed-confirmation dialogs (AC18) land in t10/t11/t14.
 *
 * AC5 defense-in-depth: the FIRST body statement of the exported
 * function is `await requireRole('manager')`. The (admin) layout has
 * already gated the segment, but this page asserts independently so a
 * future refactor that detaches it from the layout is caught by
 * `tests/auth/admin-routes-defense-in-depth.test.ts`.
 *
 * Per AC11:
 *   - Server-side query selects profiles WHERE
 *     `id_verified_at IS NULL AND id_doc_uploaded_at IS NOT NULL AND id_verification_rejected_at IS NULL`.
 *   - Each row's thumbnail is generated server-side from a
 *     1-hour-TTL signed URL produced by
 *     `supabase.storage.from('id-documents').createSignedUrl(path, 3600)`
 *     (ADR-0009). The `<img>` element receives
 *     `referrerPolicy="no-referrer"` and
 *     `alt="ID document thumbnail for {email}"`.
 *   - DOB-with-21-check banner: green "AGE OK" if `dob` < now() - 21
 *     years; red "UNDER 21 — REJECT" otherwise. Copy is verbatim per
 *     ADR-0009.
 *   - Upload timestamp renders in BOTH UTC and Central per ADR-0034.
 *   - Three action buttons (Approve, Reject, Request more info) are
 *     present but DISABLED until t10/t11/t14 ship the server actions
 *     and the typed-confirmation dialog. Buttons carry a "Pending
 *     t10/t11" `title` tooltip.
 *
 * **Signed-URL failure mode (error branch, AC11):** per-row try/catch.
 * On reject the row renders the literal placeholder
 * `"Thumbnail unavailable — refresh"` in place of the `<img>`, the
 * row's `<tr>` carries `data-thumb-failed="true"` for test discovery,
 * and the three action buttons remain on the row (disabled now;
 * actionable once t10/t11/t14 wire them). The DOB 21+ banner is
 * rendered from `profile.dob`, not the signed URL, so it is unaffected
 * by a thumbnail failure.
 *
 * Loading state: a `<Suspense>` boundary wraps the queue body and
 * falls back to a table skeleton so the role-gate + initial cookie
 * resolution don't render an empty page.
 *
 * Premortem mitigations:
 *   - R1 (admin-client misuse): the queue uses the cookie-scoped
 *     `createClient()` (RLS evaluates against the caller).
 *     Service-role bypass is intentionally absent.
 *   - R2 (signed-URL leak): URLs are generated per-render, never
 *     cached, and the `<img>` has `referrerPolicy="no-referrer"` so
 *     the URL is not echoed in the Referer header on any link the
 *     staff member follows away from this page.
 */

import { Suspense } from 'react';

import { requireRole } from '@/lib/auth/requireRole';
import { createClient } from '@/lib/supabase/server';

// Opt out of static prerender — the queue reads the Supabase session
// via cookies, which Next.js cannot evaluate at build time. Without
// this, `next build` attempts to prerender /admin/verifications and
// throws the "Supabase env vars are missing or placeholders" guard.
export const dynamic = 'force-dynamic';

// ADR-0034: every operational timestamp renders BOTH UTC and the
// club's local zone (America/Chicago, abbreviated CDT or CST).
const CENTRAL_TZ = 'America/Chicago';

// ADR-0009: signed-URL TTL for ID document thumbnails. One hour balances
// staff workflow continuity against leak-window exposure.
const SIGNED_URL_TTL_SECONDS = 3600;

// ADR-0009: Supabase Storage bucket for ID documents.
const ID_DOCUMENTS_BUCKET = 'id-documents';

/**
 * Profile row surfaced by the queue query. Only the columns the
 * surface renders are selected — `phone` and other PII columns are
 * intentionally absent from the result set to minimize accidental
 * exposure if a future refactor inlines `row` into a wider context.
 */
type VerificationRow = {
  id: string;
  full_name: string;
  email: string;
  dob: string; // ISO date YYYY-MM-DD
  id_doc_path: string | null;
  id_doc_uploaded_at: string; // ISO datetime
};

/**
 * Row data after signed-URL generation. `thumbFailed=true` means the
 * Supabase Storage call rejected — render the placeholder. `thumbUrl`
 * is `null` (not undefined) so destructuring is consistent across
 * branches. Either of (`thumbFailed`, `thumbUrl`) — never both.
 */
type ResolvedRow = VerificationRow & {
  thumbUrl: string | null;
  thumbFailed: boolean;
};

// ---- Timestamp formatter (ADR-0034) ----------------------------------------
//
// Renders an ISO timestamp as a pair of strings: one UTC, one Central.
// Mirrors `app/(admin)/admin/page.tsx` so the two surfaces stay
// presentation-consistent.

function formatUtcAndCentral(iso: string): { utc: string; central: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { utc: iso, central: iso };

  const utcParts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).formatToParts(date);
  const utc = `${pick(utcParts, 'year')}-${pick(utcParts, 'month')}-${pick(utcParts, 'day')} ${pick(utcParts, 'hour')}:${pick(utcParts, 'minute')}:${pick(utcParts, 'second')} UTC`;

  const centralParts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: CENTRAL_TZ,
    timeZoneName: 'short',
  }).formatToParts(date);
  const y = pick(centralParts, 'year');
  const m = pick(centralParts, 'month');
  const d = pick(centralParts, 'day');
  let h = pick(centralParts, 'hour');
  if (h === '24') h = '00';
  const mi = pick(centralParts, 'minute');
  const s = pick(centralParts, 'second');
  const tzName = pick(centralParts, 'timeZoneName');
  const central = `${y}-${m}-${d} ${h}:${mi}:${s} ${tzName}`;

  return { utc, central };
}

function pick(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? '';
}

// ---- Age check -------------------------------------------------------------
//
// True if the supplied `dob` (ISO YYYY-MM-DD) corresponds to an age
// >= 21 as of `at`. Conservative: treats invalid / missing DOB as
// under-21 so the surface never renders a green "AGE OK" banner over
// a missing data field. (The legal-risk asymmetry here is one-sided:
// false-negative ages the member off the queue, false-positive lets
// staff approve an under-21 — the former is recoverable, the latter
// is regulatory exposure.)

function isAgeOk(dob: string, at: Date = new Date()): boolean {
  const d = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  const cutoff = new Date(at);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 21);
  return d.getTime() <= cutoff.getTime();
}

// ---- Async queue body ------------------------------------------------------
//
// `VerificationsQueue` is declared BELOW the default-exported
// `VerificationsPage` (at end of file) so the first `await` token in
// source order is the `await requireRole('manager')` inside the page.
// AC5's regex-tier defense-in-depth walker
// (`tests/auth/admin-routes-defense-in-depth.test.ts`) scans for the
// first `\bawait\b` in source order; placing the queue body (which
// contains internal `await` calls against supabase + storage) above
// the page would silently fail the gate. Function declarations are
// hoisted, so the JSX reference resolves correctly despite the textual
// ordering.

// ---- Page ------------------------------------------------------------------

export default async function VerificationsPage(): Promise<JSX.Element> {
  // AC5 defense-in-depth: FIRST body statement is requireRole('manager').
  await requireRole('manager');

  return (
    <section
      aria-label="Verifications queue"
      style={{
        maxWidth: 1200,
        margin: '0 auto',
        color: 'var(--ivory-200)',
      }}
    >
      <header style={{ marginBottom: 24 }}>
        <div
          className="eyebrow"
          style={{
            fontSize: 11,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: 12,
          }}
        >
          Admin Console
        </div>
        <h1
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 40,
            fontWeight: 500,
            lineHeight: 1.1,
            letterSpacing: '-0.015em',
            marginBottom: 12,
          }}
        >
          Verifications
        </h1>
        <p style={{ color: 'var(--ivory-300)', fontSize: 14, lineHeight: 1.65, maxWidth: 760 }}>
          Members who have uploaded an ID document and are awaiting review.
          Confirm the photograph matches the member, then approve, reject with
          a reason, or request more information.
        </p>
      </header>

      <Suspense fallback={<TableSkeleton />}>
        {/* The queue body is async — Suspense + skeleton give the staff a
            stable layout while the cookie-scoped Supabase client resolves
            and the signed URLs round-trip. Async Server Components are
            valid in App Router; React's types still resolve correctly. */}
        <VerificationsQueue />
      </Suspense>
    </section>
  );
}

// ---- Presentational primitives --------------------------------------------

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      style={{
        padding: '12px 24px',
        fontSize: 11,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
        fontWeight: 500,
      }}
    >
      {children}
    </th>
  );
}

function AgeBanner({ ageOk }: { ageOk: boolean }) {
  // ADR-0009: verbatim copy. The two literal strings are pinned by the
  // test suite — do not abbreviate or recase.
  const label = ageOk ? 'AGE OK' : 'UNDER 21 — REJECT';
  const bg = ageOk ? 'rgba(46, 160, 67, 0.16)' : 'rgba(207, 34, 46, 0.18)';
  const fg = ageOk ? 'var(--green-400, #3fb950)' : 'var(--red-400, #ff7b72)';
  const border = ageOk
    ? '1px solid rgba(46, 160, 67, 0.45)'
    : '1px solid rgba(207, 34, 46, 0.55)';
  return (
    <span
      role="status"
      data-age-ok={ageOk ? 'true' : 'false'}
      style={{
        display: 'inline-block',
        padding: '4px 10px',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: fg,
        background: bg,
        border,
        borderRadius: 999,
      }}
    >
      {label}
    </span>
  );
}

function ActionButton({
  label,
  tone,
}: {
  label: string;
  tone: 'positive' | 'negative' | 'neutral';
}) {
  // t14 lands the typed-confirmation dialog and t10/t11 land the
  // server actions. Until then the buttons render visibly DISABLED so
  // staff see the upcoming workflow without being able to fire it.
  const accent =
    tone === 'positive'
      ? 'rgba(46, 160, 67, 0.45)'
      : tone === 'negative'
        ? 'rgba(207, 34, 46, 0.55)'
        : 'rgba(201, 162, 74, 0.45)';
  return (
    <button
      type="button"
      disabled
      title="Pending t10/t11"
      data-action={label.toLowerCase().replace(/\s+/g, '-')}
      style={{
        padding: '6px 12px',
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--ivory-300)',
        background: 'transparent',
        border: `1px solid ${accent}`,
        borderRadius: 4,
        cursor: 'not-allowed',
        opacity: 0.7,
      }}
    >
      {label}
    </button>
  );
}

function TableSkeleton() {
  // Five-row skeleton — matches the visual rhythm of the populated
  // queue so the layout doesn't reflow when the data resolves.
  const rows = Array.from({ length: 5 });
  return (
    <div
      aria-hidden="true"
      data-testid="verifications-skeleton"
      style={{
        border: '1px solid var(--border-faint)',
        borderRadius: 8,
        background: 'var(--ink-850)',
        overflow: 'hidden',
      }}
    >
      {rows.map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '14px 24px',
            borderTop: i === 0 ? 'none' : '1px solid var(--border-faint)',
          }}
        >
          <div
            style={{
              width: 96,
              height: 60,
              borderRadius: 4,
              background: 'rgba(255,255,255,0.04)',
            }}
          />
          <div style={{ flex: 1, height: 12, background: 'rgba(255,255,255,0.04)', borderRadius: 4 }} />
          <div style={{ width: 120, height: 12, background: 'rgba(255,255,255,0.04)', borderRadius: 4 }} />
          <div style={{ width: 200, height: 12, background: 'rgba(255,255,255,0.04)', borderRadius: 4 }} />
        </div>
      ))}
    </div>
  );
}

// ---- Async queue body (declared AFTER VerificationsPage per AC5 first-await contract) ----
//
// See the header comment above VerificationsPage for the source-order
// rationale. JSX reference resolves via function-declaration hoisting.

async function VerificationsQueue(): Promise<JSX.Element> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, dob, id_doc_path, id_doc_uploaded_at')
    .is('id_verified_at', null)
    .not('id_doc_uploaded_at', 'is', null)
    .is('id_verification_rejected_at', null)
    .order('id_doc_uploaded_at', { ascending: true });

  // Errors here surface to the segment error.tsx boundary. We do NOT
  // attempt to render a partial queue on read-failure — staff need an
  // explicit "something is wrong" signal, not a misleading empty queue.
  if (error) {
    throw new Error(`Failed to load verification queue: ${error.message}`);
  }

  const rows = (data ?? []) as VerificationRow[];

  // Per-row signed-URL generation. Each row's call is independent
  // (no early return), so a single 5xx does not poison the whole
  // queue — the row degrades to the "Thumbnail unavailable — refresh"
  // placeholder per AC11.
  const resolved: ResolvedRow[] = await Promise.all(
    rows.map(async (row): Promise<ResolvedRow> => {
      if (!row.id_doc_path) {
        return { ...row, thumbUrl: null, thumbFailed: true };
      }
      try {
        const { data: signed, error: signErr } = await supabase.storage
          .from(ID_DOCUMENTS_BUCKET)
          .createSignedUrl(row.id_doc_path, SIGNED_URL_TTL_SECONDS);
        if (signErr || !signed?.signedUrl) {
          return { ...row, thumbUrl: null, thumbFailed: true };
        }
        return { ...row, thumbUrl: signed.signedUrl, thumbFailed: false };
      } catch {
        // Sentry breadcrumb seam (ADR-0014). Today the redactor strips
        // `id_doc_path`, so we cannot include it in the breadcrumb;
        // the row's audit identity is the profile id, which is safe.
        return { ...row, thumbUrl: null, thumbFailed: true };
      }
    }),
  );

  if (resolved.length === 0) {
    return (
      <div
        role="status"
        style={{
          padding: '48px 24px',
          textAlign: 'center',
          color: 'var(--ivory-400)',
          fontSize: 14,
          border: '1px solid var(--border-faint)',
          borderRadius: 8,
          background: 'var(--ink-850)',
        }}
      >
        No rows match these filters.
      </div>
    );
  }

  return (
    <div
      style={{
        border: '1px solid var(--border-faint)',
        borderRadius: 8,
        background: 'var(--ink-850)',
        overflow: 'hidden',
      }}
    >
      <table
        role="table"
        aria-label="Pending ID verifications"
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 13,
          color: 'var(--ivory-300)',
        }}
      >
        <thead>
          <tr style={{ textAlign: 'left' }}>
            <Th>Document</Th>
            <Th>Age check</Th>
            <Th>Member</Th>
            <Th>Uploaded (UTC / Central)</Th>
            <Th>Actions</Th>
          </tr>
        </thead>
        <tbody>
          {resolved.map((row) => {
            const ageOk = isAgeOk(row.dob);
            const { utc, central } = formatUtcAndCentral(row.id_doc_uploaded_at);
            return (
              <tr
                key={row.id}
                data-thumb-failed={row.thumbFailed ? 'true' : undefined}
                style={{ borderTop: '1px solid var(--border-faint)' }}
              >
                <td style={{ padding: '14px 24px', width: 120 }}>
                  {row.thumbFailed || !row.thumbUrl ? (
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '12px 14px',
                        fontSize: 12,
                        color: 'var(--ivory-400)',
                        border: '1px dashed var(--border-faint)',
                        borderRadius: 4,
                        background: 'rgba(0,0,0,0.18)',
                      }}
                    >
                      Thumbnail unavailable — refresh
                    </span>
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element -- signed URL with 1hr TTL; next/image bundles client JS we don't need for the staff-only surface */
                    <img
                      src={row.thumbUrl}
                      alt={`ID document thumbnail for ${row.email}`}
                      referrerPolicy="no-referrer"
                      style={{
                        display: 'block',
                        width: 96,
                        height: 60,
                        objectFit: 'cover',
                        borderRadius: 4,
                        border: '1px solid var(--border-faint)',
                      }}
                    />
                  )}
                </td>
                <td style={{ padding: '14px 24px' }}>
                  <AgeBanner ageOk={ageOk} />
                </td>
                <td style={{ padding: '14px 24px' }}>
                  <div style={{ color: 'var(--ivory-200)', fontWeight: 500 }}>{row.full_name}</div>
                  <div style={{ color: 'var(--ivory-400)', fontSize: 12 }}>{row.email}</div>
                </td>
                <td style={{ padding: '14px 24px' }}>
                  <div>{utc}</div>
                  <div style={{ color: 'var(--ivory-400)', fontSize: 12 }}>{central}</div>
                </td>
                <td style={{ padding: '14px 24px' }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <ActionButton label="Approve" tone="positive" />
                    <ActionButton label="Reject" tone="negative" />
                    <ActionButton label="Request more info" tone="neutral" />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
