/**
 * Cross-cutting source-grep regression guard against PII leaking into
 * the admin audit log (ADR-0035 AC28, premortem R4, WD.T19 / t21).
 *
 * Run locally:    pnpm test tests/admin/no-pii-in-admin-audit.test.ts
 * Prerequisites:  none — pure source-text scan via node:fs readFileSync.
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC28.
 *
 * Contract:
 *   - Read every server-action file under
 *     `app/(admin)/admin/**\/_actions/*.ts`.
 *   - Scope the scan to the `before:` / `after:` JSON-object regions
 *     returned by each `withAudit` `mutate` callback. The action's
 *     other code (e.g. SELECT building, error messages, console.warn
 *     breadcrumbs) is allowed to mention these column names — the
 *     load-bearing invariant is "no PII enters the persisted audit row".
 *   - Forbidden literal substrings inside `before` / `after` payloads:
 *       'email', 'full_name', 'phone', 'dob',
 *       'reject_reason:' (only `_length` variant permitted),
 *       'message:' (only `_length` variant permitted),
 *       'requester_email' (premortem R7 — approveDeletion stores
 *       `request_id` not `requester_email`).
 *   - Approach: extract every `before: { ... }` and `after: { ... }`
 *     payload region with a balanced-brace walker so a nested
 *     `{ ... }` inside the value doesn't truncate extraction.
 *
 * The check is coarse but high-signal — a future "refactor for
 * cleanliness" pass that lifts `requester_email` into the audit row
 * would otherwise leak PII into the forever-retained audit log.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename =
  typeof __dirname === 'undefined'
    ? fileURLToPath(import.meta.url)
    : `${__dirname}/__placeholder__`;
const TEST_DIR = typeof __dirname === 'undefined' ? dirname(__filename) : __dirname;
const ADMIN_ROOT = resolve(TEST_DIR, '..', '..', 'app', '(admin)', 'admin');

function collectActionFiles(root: string): string[] {
  const results: string[] = [];
  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith('.ts')) continue;
      const norm = full.replace(/\\/g, '/');
      if (!/\/_actions\//.test(norm)) continue;
      results.push(full);
    }
  }
  walk(root);
  return results;
}

interface ForbiddenToken {
  needle: string;
  rationale: string;
  /** Allow `<needle>_length`, `<needle>_hash` suffixes when set. */
  allowSuffix?: boolean;
}

const FORBIDDEN: ReadonlyArray<ForbiddenToken> = [
  {
    needle: 'email',
    rationale:
      'Email addresses are PII. Capture only `request_id` or `_length` (premortem R4/R7).',
    allowSuffix: true,
  },
  {
    needle: 'full_name',
    rationale: 'Full names are PII; audit before/after must omit them.',
  },
  {
    needle: 'phone',
    rationale: 'Phone numbers are PII; audit before/after must omit them.',
  },
  {
    needle: 'dob',
    rationale: 'Dates of birth are PII; audit before/after must omit them.',
  },
  {
    needle: 'reject_reason:',
    rationale:
      'Verbatim reject reasons are PII-adjacent free text. Only `reject_reason_length:` is permitted.',
  },
  {
    needle: 'message:',
    rationale:
      'Verbatim message bodies are PII-adjacent. Only `message_length:` / `info_request_message_length:` are permitted.',
  },
  {
    needle: 'requester_email',
    rationale:
      'Requester email is the load-bearing premortem R7 token. approveDeletion must capture `request_id` only.',
    allowSuffix: true,
  },
];

/**
 * Walk balanced braces starting at `open` (must point to `{` in src).
 * Returns the slice from `open` to the matching `}` inclusive, or null
 * if no balanced close was found.
 */
function balancedSpan(src: string, open: number): string | null {
  if (src[open] !== '{') return null;
  let depth = 0;
  let inString: string | null = null;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i]!;
    if (inString) {
      if (c === '\\') {
        i += 1;
        continue;
      }
      if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      inString = c;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

/**
 * Extract every `before: { ... }` and `after: { ... }` span.
 * The non-object literal forms (`before: null`, `before: someVar`)
 * are skipped — they carry no PII payload to inspect.
 */
function extractBeforeAfterSpans(src: string): string[] {
  const spans: string[] = [];
  const re = /\b(?:before|after)\s*:\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    // m.index points to start of `before|after`; find the `{`.
    const braceIdx = src.indexOf('{', m.index + m[0].length - 1);
    if (braceIdx === -1) continue;
    const span = balancedSpan(src, braceIdx);
    if (span !== null) spans.push(span);
  }
  return spans;
}

interface Finding {
  file: string;
  token: string;
  rationale: string;
  preview: string;
}

function scanPayloadForPii(file: string, payload: string): Finding[] {
  const findings: Finding[] = [];
  // Strip JS-style comments inside the span so reviewer JSDoc-style
  // mentions don't false-positive.
  const stripped = payload
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  for (const tok of FORBIDDEN) {
    let idx = stripped.indexOf(tok.needle);
    while (idx !== -1) {
      if (tok.allowSuffix) {
        const tail = stripped.slice(
          idx + tok.needle.length,
          idx + tok.needle.length + 12,
        );
        if (/^_(length|hash|digest)\b/.test(tail)) {
          idx = stripped.indexOf(tok.needle, idx + 1);
          continue;
        }
      }
      findings.push({
        file,
        token: tok.needle,
        rationale: tok.rationale,
        preview: stripped.slice(
          Math.max(0, idx - 30),
          Math.min(stripped.length, idx + 60),
        ),
      });
      idx = stripped.indexOf(tok.needle, idx + 1);
    }
  }
  return findings;
}

describe('AC28 — no PII in admin audit before/after payloads', () => {
  const files = collectActionFiles(ADMIN_ROOT);

  it('finds at least eight _actions/*.ts files (smoke check)', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it('no forbidden PII token appears inside any before/after value across all admin actions', () => {
    const allFindings: Finding[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const spans = extractBeforeAfterSpans(src);
      for (const span of spans) {
        allFindings.push(...scanPayloadForPii(f, span));
      }
    }
    if (allFindings.length > 0) {
      const msg = allFindings
        .map(
          (fi) =>
            `  ${fi.file}\n    token: ${fi.token}\n    rationale: ${fi.rationale}\n    preview: ...${fi.preview}...`,
        )
        .join('\n');
      throw new Error(
        `AC28 PII leak: ${allFindings.length} forbidden token(s) found in before/after payloads:\n${msg}`,
      );
    }
  });

  it('approveDeletion captures request_id (not requester_email) in audit after (premortem R7)', () => {
    const file = files.find((f) =>
      f.replace(/\\/g, '/').includes('privacy/_actions/approveDeletion.ts'),
    );
    expect(file).toBeTruthy();
    if (!file) return;
    const src = readFileSync(file, 'utf8');
    const spans = extractBeforeAfterSpans(src);
    const hasRequestId = spans.some((s) => /\brequest_id\b/.test(s));
    expect(hasRequestId).toBe(true);
    const leak = spans.find((s) => /\brequester_email\b/.test(s));
    expect(
      leak,
      `approveDeletion before/after contained requester_email: ${leak ?? ''}`,
    ).toBeUndefined();
  });
});
