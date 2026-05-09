/**
 * RFC-style rate-limit headers — ADR-0016.
 */
import type { Decision } from './types';

export function rateLimitHeaders(decision: Decision): Record<string, string> {
  // `X-RateLimit-Reset` is conventionally seconds, not ms.
  return {
    'X-RateLimit-Limit': String(decision.limit),
    'X-RateLimit-Remaining': String(decision.remaining),
    'X-RateLimit-Reset': String(Math.ceil(decision.reset_at_ms / 1000)),
  };
}
