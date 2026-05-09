/**
 * Bucket policy per ADR-0016.
 */
import type { Bucket, BucketKey } from './types';

const MIN = 60_000;
const HOUR = 60 * MIN;

export const BUCKETS: Record<BucketKey, Bucket> = {
  anonymous: {
    limit: 60,
    window_ms: MIN,
    description: 'Anonymous traffic — 60 req/min per IP across all routes',
  },
  login: {
    limit: 5,
    window_ms: 15 * MIN,
    description: 'Login attempts — 5 per 15 min per IP',
  },
  signup: {
    limit: 3,
    window_ms: HOUR,
    description: 'Signup starts — 3 per hour per IP',
  },
  contact_form: {
    limit: 3,
    window_ms: HOUR,
    description: 'Contact form submissions — 3 per hour per IP',
  },
  member: {
    limit: 600,
    window_ms: MIN,
    description: 'Authenticated member — 600 req/min',
  },
  staff: {
    limit: 1200,
    window_ms: MIN,
    description: 'Authenticated staff — 1200 req/min (cashier flows are bursty)',
  },
};
