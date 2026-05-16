import { NextResponse } from 'next/server';
import { nowUtc } from '@/lib/time';

/**
 * Liveness probe for uptime monitor.
 * See ADR-0014 (Observability) and ADR-0015 (Alerting).
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({
    status: 'ok',
    env: process.env['NEXT_PUBLIC_APP_ENV'] ?? 'unknown',
    timestamp: nowUtc().toISOString(),
  });
}
