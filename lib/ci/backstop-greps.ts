/**
 * Single source of truth for backstop greps run in CI (.github/workflows/ci.yml)
 * AND in vitest at tests/ci/backstop-greps.test.ts. Keeps workflow grep
 * patterns and local test patterns in sync.
 */

/**
 * Forbids *_cents columns declared with floating-point types.
 * Per ADR-0004, money columns must be INTEGER (or BIGINT). Naming a column
 * *_cents but typing it as decimal/numeric/float/real/double-precision is
 * the realistic mistake that destroys money.
 */
export const CENTS_FLOAT_TYPE_PATTERN = /[a-zA-Z_]+_cents\s+(decimal|numeric|float|real|double\s+precision)\b/i;

/**
 * Forbids any reference to SUPABASE_SERVICE_ROLE_KEY in client-side trees.
 * Per ADR-0007, the service-role key is server-only. Any reference (even
 * process.env.SUPABASE_SERVICE_ROLE_KEY) in client code is a leak waiting
 * to happen. The grep target paths (app/(member)/, app/(marketing)/,
 * components/) are the client-side surfaces.
 */
export const SERVICE_ROLE_KEY_BARE_PATTERN = /SUPABASE_SERVICE_ROLE_KEY/;

/** A list of all backstop patterns for shell consumption. */
export const BACKSTOP_GREPS: ReadonlyArray<{
  name: string;
  pattern: RegExp;
  description: string;
  glob: string;
  paths?: ReadonlyArray<string>;
}> = [
  {
    name: 'cents-float-type',
    pattern: CENTS_FLOAT_TYPE_PATTERN,
    description: '*_cents columns must be INTEGER per ADR-0004; flag floating-point types',
    glob: '**/*.{sql,ts}',
  },
  {
    name: 'service-role-key-in-client',
    pattern: SERVICE_ROLE_KEY_BARE_PATTERN,
    description: 'Service-role key forbidden in client trees per ADR-0007',
    glob: '**/*.{ts,tsx,js,mjs}',
    paths: ['app/(member)/', 'app/(marketing)/', 'components/'],
  },
];
