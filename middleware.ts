import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

/**
 * Prefixes that require an authenticated session. Anything outside this list
 * (marketing pages, auth pages, API routes that handle their own auth) passes
 * through untouched. `/admin/*` and `/cashier/*` ship with cycle 5 — pre-gating
 * them here means cycle 5 has one less moving part. The `/cashier` prefix is
 * NOT included this cycle per spec t2 scope; it lands when the staff routes do.
 */
const GATED_PREFIXES = ['/dashboard', '/profile', '/admin'] as const;

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const search = request.nextUrl.search;

  // Spec AC10: set an `x-pathname` request header on the forwarded request so
  // server components (specifically `lib/auth/requireRole.ts`) can read the
  // current path via Next 14's `headers()`. Server actions / RSCs CAN'T read
  // the request URL directly — this header is the documented handshake.
  //
  // Mutate `request.headers` BEFORE calling `updateSession`, because the
  // cycle-1 `updateSession` constructs the forwarded response via
  // `NextResponse.next({ request })`, which freezes the request-header set at
  // call time. Setting the header after updateSession returns would not
  // propagate to RSCs.
  //
  // We split path and search into two headers (`x-pathname` + `x-search`) to
  // match the read-side contract in `lib/auth/requireRole.ts`, which reads
  // them as separate values and concatenates before encoding.
  request.headers.set('x-pathname', pathname);
  request.headers.set('x-search', search);

  // Cycle-1 cookie-refresh runs first and verbatim. updateSession now also
  // returns the current user so we can decide gating without rebuilding the
  // supabase client.
  const { response, user } = await updateSession(request);

  // Use exact-match-or-prefix-with-slash to avoid the substring trap:
  // `/admin-evil` MUST NOT match `/admin`. `pathname === p` covers `/admin`,
  // `pathname.startsWith(p + '/')` covers `/admin/users` etc.
  const isGated = GATED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (isGated && !user) {
    const next = encodeURIComponent(pathname + search);
    return NextResponse.redirect(new URL(`/login?next=${next}`, request.url));
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for static assets and image optimization.
     * Auth-protected routes are enforced inside the middleware logic above
     * (gated-prefix check) for /dashboard, /profile, /admin/*. Marketing
     * routes pass through untouched.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)',
  ],
};
