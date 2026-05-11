/**
 * `applyRateLimit` — the Edge Middleware entry point.
 *
 * Slice 1 default: monitor-only mode. The limiter computes the decision and
 * the headers; the caller chooses whether to honor `decision.allowed`.
 * `middleware.ts` at the project root currently flips on the
 * `RATE_LIMIT_MODE` env var: `enforce` returns a 429 response when
 * disallowed; anything else returns the headers but lets the request
 * through.
 */
import { defaultStore, type Store } from './store';
import { rateLimitHeaders } from './headers';
import type { BucketKey, Decision } from './types';
import { nowUtc } from '../time';

export interface RateLimitResult {
  decision: Decision;
  headers: Record<string, string>;
}

export async function applyRateLimit(
  bucketKey: BucketKey,
  subject: string,
  options: { store?: Store; now?: () => number } = {},
): Promise<RateLimitResult> {
  const store = options.store ?? defaultStore;
  const now = options.now ?? Date.now;
  const decision = await store.hit(bucketKey, subject, now());
  return {
    decision,
    headers: rateLimitHeaders(decision),
  };
}

/**
 * Pulls the request's IP for use as the rate-limit subject. Tries the
 * standard proxy headers first (Vercel sets these), falls back to a
 * deterministic placeholder so the limiter still functions in local dev
 * without any X-Forwarded-For.
 */
export function ipFromHeaders(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    // First entry in the comma-separated list is the original client.
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}

export const RATE_LIMIT_MODE_ENFORCE = 'enforce';

export function isEnforceMode(): boolean {
  return process.env.RATE_LIMIT_MODE === RATE_LIMIT_MODE_ENFORCE;
}

/**
 * Body returned for 429 responses in enforce mode.
 */
export function rateLimitedBody(
  decision: Decision,
  nowMs: number = nowUtc().getTime(),
): {
  error: 'rate_limited';
  retry_after_seconds: number;
} {
  const retryAfter = Math.max(1, Math.ceil((decision.reset_at_ms - nowMs) / 1000));
  return { error: 'rate_limited', retry_after_seconds: retryAfter };
}
