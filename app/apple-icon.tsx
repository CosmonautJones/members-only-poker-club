/**
 * `/apple-icon.tsx` — Next 14 dynamic Apple touch icon.
 *
 * Audit 2026-05-15 P2 #8 follow-up: iOS home-screen pin needs a 180×180
 * variant. Renders the same brand mark at a larger size so the chip's
 * "MO" wordmark sits properly inside the gold edge ring.
 */

import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
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
          border: '10px solid #C9A24A',
          color: '#C9A24A',
          fontFamily: 'serif',
          fontWeight: 600,
          fontSize: 88,
          letterSpacing: 4,
        }}
      >
        MO
      </div>
    ),
    { ...size },
  );
}
