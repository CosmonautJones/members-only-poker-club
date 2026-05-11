import 'server-only';
/**
 * Custom error thrown when a caller's role rank is below the required role.
 *
 * Public `message` follows the form `Insufficient role: required <r>, got <a>`
 * — this is fine for server-side logs and tests, but route handlers / RSCs
 * MUST map `instanceof InsufficientRoleError` to a generic 403 ('Forbidden')
 * response body so role names never leak into client-visible payloads.
 *
 * Constructed with the structured `required` and `actual` fields so callers
 * (e.g. `lib/auth/requireRole.ts`) can log the privilege escalation attempt
 * without re-parsing the message.
 *
 * The `import 'server-only';` directive on line 1 is LOAD-BEARING: the
 * `InsufficientRoleError` class names role values in its message and is a
 * privilege-related error type. If a refactor accidentally pulls this file
 * into a client bundle (e.g. via a shared types module re-export), the
 * directive trips Next's compiler and fails the build rather than silently
 * shipping role-error semantics to the browser.
 *
 * See ADR-0002 (Authentication) and ADR-0003 (Authorization model).
 */
export class InsufficientRoleError extends Error {
  constructor(
    public readonly required: string,
    public readonly actual: string,
  ) {
    super(`Insufficient role: required ${required}, got ${actual}`);
    this.name = 'InsufficientRoleError';
  }
}
