/**
 * Dynamic OpenGraph image route — `/og`.
 *
 * Renders a 1200x630 branded PNG driven by `?title=` and `?subtitle=`
 * query params. Used by every marketing page's `openGraph.images` so
 * shared links produce a consistent, branded preview card.
 *
 * Per ADR-0030 (SEO & content strategy):
 * - Edge runtime (cheap, fast, ships with Next 14's `next/og`).
 * - Brand palette pulled from `app/globals.css`: ink `#0b0b0b`, gold
 *   `#c9a24a`, ivory `#f4ede0`, gold accent `#e5ba63`.
 * - Default title is the brand if none is provided; subtitle is empty
 *   by default so callers can omit it for non-page-specific cards.
 *
 * Acceptance criterion 2 (ADR-0030 spec): returns 200 with
 * `content-type: image/png` for `?title=...&subtitle=...`.
 */

import { ImageResponse } from 'next/og';

export const runtime = 'edge';

const DEFAULT_TITLE = 'Members Only Poker Social Club';
const DEFAULT_SUBTITLE = '';

const INK_900 = '#0b0b0b';
const INK_800 = '#1a1816';
const GOLD_300 = '#e5ba63';
const GOLD_400 = '#c9a24a';
const GOLD_600 = '#6e5520';
const IVORY_200 = '#f4ede0';
const IVORY_400 = '#c9bfa9';

export function GET(request: Request): ImageResponse {
  const { searchParams } = new URL(request.url);
  const rawTitle = searchParams.get('title');
  const rawSubtitle = searchParams.get('subtitle');

  const title = (rawTitle ?? DEFAULT_TITLE).slice(0, 120);
  const subtitle = (rawSubtitle ?? DEFAULT_SUBTITLE).slice(0, 160);

  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: `radial-gradient(ellipse at center top, ${INK_800} 0%, ${INK_900} 70%)`,
        padding: '80px',
        position: 'relative',
      }}
    >
      {/* Top gold rule */}
      <div
        style={{
          position: 'absolute',
          top: 60,
          left: 80,
          right: 80,
          height: 1,
          background: GOLD_400,
          opacity: 0.5,
          display: 'flex',
        }}
      />

      {/* Eyebrow */}
      <div
        style={{
          color: GOLD_300,
          fontSize: 22,
          letterSpacing: '0.32em',
          textTransform: 'uppercase',
          marginBottom: 28,
          display: 'flex',
        }}
      >
        Est. MMXXIV · Private Social Club
      </div>

      {/* Title */}
      <div
        style={{
          color: GOLD_300,
          fontSize: title.length > 40 ? 76 : 96,
          fontWeight: 600,
          lineHeight: 1.1,
          letterSpacing: '-0.015em',
          textAlign: 'center',
          maxWidth: 1040,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        {title}
      </div>

      {/* Subtitle */}
      {subtitle ? (
        <div
          style={{
            color: IVORY_200,
            fontSize: 32,
            lineHeight: 1.4,
            marginTop: 36,
            textAlign: 'center',
            maxWidth: 980,
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          {subtitle}
        </div>
      ) : null}

      {/* Bottom gold rule */}
      <div
        style={{
          position: 'absolute',
          bottom: 60,
          left: 80,
          right: 80,
          height: 1,
          background: GOLD_400,
          opacity: 0.5,
          display: 'flex',
        }}
      />

      {/* Bottom brand line */}
      <div
        style={{
          position: 'absolute',
          bottom: 28,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          color: IVORY_400,
          fontSize: 18,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
        }}
      >
        membersonlypoker.com
      </div>

      {/* Corner gold dot accents */}
      <div
        style={{
          position: 'absolute',
          top: 56,
          left: 76,
          width: 8,
          height: 8,
          background: GOLD_300,
          borderRadius: 4,
          display: 'flex',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 56,
          right: 76,
          width: 8,
          height: 8,
          background: GOLD_300,
          borderRadius: 4,
          display: 'flex',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 56,
          left: 76,
          width: 8,
          height: 8,
          background: GOLD_600,
          borderRadius: 4,
          display: 'flex',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 56,
          right: 76,
          width: 8,
          height: 8,
          background: GOLD_600,
          borderRadius: 4,
          display: 'flex',
        }}
      />
    </div>,
    {
      width: 1200,
      height: 630,
    },
  );
}

// Re-export `GET` as the default export so callers / tests that look for
// `mod.default` still resolve to the same handler. Next.js route handlers
// are dispatched by their HTTP-method-named exports (`GET`); the default
// export is purely for ergonomics and is never invoked by the framework.
export default GET;
