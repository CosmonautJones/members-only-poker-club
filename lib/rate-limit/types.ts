/**
 * Rate-limit primitives — ADR-0016.
 */

export type BucketKey = 'anonymous' | 'login' | 'signup' | 'contact_form' | 'member' | 'staff';

export interface Bucket {
  /** Max requests per `window_ms`. */
  readonly limit: number;
  /** Window length in milliseconds. */
  readonly window_ms: number;
  /** Human description for logs and the `/admin/rate-limits` UI later. */
  readonly description: string;
}

export interface Decision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** When the bucket resets, in epoch ms. */
  readonly reset_at_ms: number;
}
