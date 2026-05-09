/**
 * PII redaction at the observability boundary — ADR-0014 + ADR-0023.
 *
 * Used by the structured logger and the Sentry beforeSend hook. The keys
 * listed below are redacted regardless of where they appear in the value
 * tree (recursive walk). Pattern matches are case-insensitive on the
 * key name, so `Email`, `EMAIL`, `email_address` all redact.
 *
 * The redacted placeholder is `'[redacted]'` (literal string). The shape
 * of the value is preserved so downstream consumers can still see "this
 * field was here" without seeing its content.
 */

const PII_KEY_PATTERNS: ReadonlyArray<RegExp> = [
  /^email$/i,
  /^email_/i,
  /_email$/i,
  /^phone$/i,
  /^phone_/i,
  /_phone$/i,
  /^dob$/i,
  /^date_of_birth$/i,
  /^birth(?:date|day)$/i,
  /^id_doc/i,
  /^stripe_/i,
  /^password$/i,
  /^token$/i,
  /^auth_token$/i,
  /^access_token$/i,
  /^refresh_token$/i,
  /^secret$/i,
  /_secret$/i,
  /^api_key$/i,
  /^cookie$/i,
  /^session_id$/i,
];

const REDACTED = '[redacted]' as const;

export function isPiiKey(key: string): boolean {
  return PII_KEY_PATTERNS.some((re) => re.test(key));
}

/**
 * Recursively redact PII fields from a value.
 *
 * Arrays are walked element-wise. Plain objects have their keys tested
 * against the PII pattern list; matching keys' values are replaced with
 * the redaction marker; non-matching keys' values are recursively
 * redacted (so a non-PII key whose value is an object still gets its
 * inner PII redacted).
 *
 * Primitives pass through unchanged. `null` and `undefined` pass through.
 *
 * Cycle handling: tracks a WeakSet of seen objects to avoid infinite
 * recursion on cyclic graphs (rare in log payloads, but defensive).
 */
export function redactPii(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactPii(item, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (isPiiKey(key)) {
      out[key] = REDACTED;
    } else {
      out[key] = redactPii(v, seen);
    }
  }
  return out;
}
