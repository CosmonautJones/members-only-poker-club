import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import {
  applyRateLimit,
  ipFromHeaders,
  isEnforceMode,
  rateLimitedBody,
} from '@/lib/rate-limit/middleware';
import { nowUtc } from '@/lib/time';

const GATED_PREFIXES = ['/dashboard', '/profile', '/admin'] as const;

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const search = request.nextUrl.search;

  // Spec AC10: x-pathname / x-search BEFORE updateSession so RSCs see them.
  request.headers.set('x-pathname', pathname);
  request.headers.set('x-search', search);

  // ADR-0016 AC5: anonymous-bucket rate limit per IP for every matched route.
  // Monitor-only by default (RATE_LIMIT_MODE !== 'enforce') — headers are
  // attached to the response below but allowed=false does NOT 429 unless
  // enforce mode is on. This lets us measure bucket sizing in prod with zero
  // user-facing risk before flipping to enforce.
  const ip = ipFromHeaders(request.headers);
  const rateLimit = await applyRateLimit('anonymous', `ip:${ip}`);

  if (!rateLimit.decision.allowed && isEnforceMode()) {
    const body = rateLimitedBody(rateLimit.decision, nowUtc().getTime());
    return NextResponse.json(body, {
      status: 429,
      headers: {
        ...rateLimit.headers,
        'Retry-After': String(body.retry_after_seconds),
      },
    });
  }

  const { response, user } = await updateSession(request);

  // Use exact-match-or-prefix-with-slash to avoid the substring trap:
  // `/admin-evil` MUST NOT match `/admin`.
  const isGated = GATED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (isGated && !user) {
    const next = encodeURIComponent(pathname + search);
    const redirect = NextResponse.redirect(new URL(`/login?next=${next}`, request.url));
    for (const [k, v] of Object.entries(rateLimit.headers)) {
      redirect.headers.set(k, v);
    }
    return redirect;
  }

  for (const [k, v] of Object.entries(rateLimit.headers)) {
    response.headers.set(k, v);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for static assets and image optimization.
     * Auth-protected routes are enforced inside the middleware logic above
     * (gated-prefix check) for /dashboard, /profile, /admin/*. Marketing
     * routes pass through untouched (but still get rate-limit headers per
     * ADR-0016 AC5).
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)',
  ],
};
