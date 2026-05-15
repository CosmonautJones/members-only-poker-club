/**
 * `/icon.tsx` — Next 14 dynamic favicon.
 *
 * Audit 2026-05-15 P2 #8: browsers and crawlers were hitting a 404 on
 * `/favicon.ico` because no app/favicon.ico or app/icon.tsx existed.
 *
 * Renders a simplified version of the brand `<Chip />` SVG mark — gold
 * edge ring with the centered "MO" wordmark, on the dark ink background.
 * The full chip's laurel + dash pattern doesn't survive 32×32, so this
 * is a hand-tuned reduction rather than a verbatim re-render of the
 * marketing primitive.
 *
 * Returns a 32×32 PNG via `next/og` ImageResponse so the same image
 * surface serves browser tabs, Google's crawler, and macOS Safari.
 */

import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background:
            'radial-gradient(circle at 50% 40%, #2a2620 0%, #15130F 60%, #0B0B0B 100%)',
          borderRadius: '50%',
          border: '2px solid #C9A24A',
          color: '#C9A24A',
          fontFamily: 'serif',
          fontWeight: 600,
          fontSize: 16,
          letterSpacing: 1,
        }}
      >
        MO
      </div>
    ),
    { ...size },
  );
}
