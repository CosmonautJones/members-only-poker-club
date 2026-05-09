/**
 * Rate-limit store interface + in-memory implementation — ADR-0016.
 *
 * The interface is the seam where Upstash Redis swaps in. v1 ships
 * `InMemoryStore` (per-process; resets on deploy). Production traffic at
 * v1 scale is fine with this — the bucket is meant to deter abuse, not
 * achieve perfect global coordination across edge functions.
 *
 * When UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN secrets land,
 * an `UpstashStore` implements the same `Store` interface and the
 * middleware swaps the constructor.
 */
import { BUCKETS } from './buckets';
import type { BucketKey, Decision } from './types';

export interface Store {
  hit(bucketKey: BucketKey, subject: string, nowMs: number): Promise<Decision>;
}

interface BucketEntry {
  /** Hit timestamps (epoch ms) within the active window. */
  hits: number[];
  /** When the active window started. */
  windowStartMs: number;
}

/**
 * Sliding-window-ish: we keep a list of hit timestamps and trim entries
 * older than `now - window_ms` on every check. Memory pressure is bounded
 * by the bucket's `limit` (we'd never need to retain more than that many
 * timestamps to compute the next decision).
 */
export class InMemoryStore implements Store {
  private readonly state = new Map<string, BucketEntry>();

  // The InMemoryStore implementation is fully synchronous, but the Store
  // interface returns a Promise so the Upstash adapter (a real network
  // round-trip) can drop in later without changing call sites. We declare
  // the method non-async and return Promise.resolve(...) so the lint rule
  // (require-await) doesn't fire.
  hit(bucketKey: BucketKey, subject: string, nowMs: number): Promise<Decision> {
    const bucket = BUCKETS[bucketKey];
    const key = `${bucketKey}:${subject}`;
    const cutoff = nowMs - bucket.window_ms;

    const entry = this.state.get(key) ?? { hits: [], windowStartMs: nowMs };
    // Drop hits that are older than the window.
    entry.hits = entry.hits.filter((ts) => ts > cutoff);

    const allowed = entry.hits.length < bucket.limit;
    if (allowed) entry.hits.push(nowMs);

    this.state.set(key, entry);

    const earliestHit = entry.hits[0] ?? nowMs;
    const resetAtMs = earliestHit + bucket.window_ms;
    const remaining = Math.max(0, bucket.limit - entry.hits.length);

    return Promise.resolve({
      allowed,
      limit: bucket.limit,
      remaining,
      reset_at_ms: resetAtMs,
    });
  }

  /** Test helper — clears all buckets. */
  clear(): void {
    this.state.clear();
  }
}

/** Singleton store for the running process. The Upstash adapter swaps this
 * when its secrets are configured. */
export const defaultStore: Store = new InMemoryStore();
