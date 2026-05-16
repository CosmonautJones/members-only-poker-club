#!/usr/bin/env node
/**
 * SQL day-bucket lint — ADR-0034 §"Storage and database rules".
 *
 * Flags bare `date_trunc('day'|'hour'|'week'|'month', x)` calls (i.e. those
 * NOT followed by `at time zone <zone>` within the same SQL expression) inside
 * the configured directory scope. Day/hour/week/month buckets in any business-
 * meaningful query MUST express the zone explicitly per ADR-0034; this lint
 * is the in-application defense against the latent-bug surface premortem-risk-4
 * flags (a connection that `SET timezone` overrides the role default and
 * silently rebuckets aggregations across a DST seam).
 *
 * Scope: by default, every `.sql` file under `db/queries/reports/**`. The
 * scope is configurable via the programmatic API (see `lintSqlDayBucket`)
 * for tests; the default is intentionally narrow — out-of-scope SQL (ad-hoc
 * analytics, internal-only debug queries) is exempt per ADR-0034.
 *
 * Usage:
 *   node scripts/lint/sql-day-bucket.mjs    # scan default scope (db/queries/reports/**)
 *
 * Exit codes:
 *   0 — no findings
 *   1 — findings (printed to stdout in the same format as
 *       scripts/check-migration-safety.mjs)
 *
 * CI wiring (adding a `pnpm lint:sql-day-bucket` script entry or a CI workflow
 * step) is explicitly deferred to a later harmonized lint cycle — this script
 * ships standalone (per spec AC8 closing paragraph).
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

/**
 * The default scope glob, per ADR-0034 §"Storage and database rules".
 * Declared at the top of the file as required by the spec.
 */
export const SCOPE = 'db/queries/reports/**';

/**
 * Detects `date_trunc('day'|'hour'|'week'|'month', <expr>)` calls. The capture
 * group is the bucket size; the body of the call (the second argument) is
 * captured implicitly via the surrounding `[^)]+` — we only need the position
 * and a small window after it to check for `at time zone`.
 */
const DATE_TRUNC_RE = /date_trunc\s*\(\s*'(day|hour|week|month)'\s*,\s*[^)]+\)/gi;

/**
 * Proximity window for `at time zone` after a match. Per ADR-0034 §AC8:
 * "within ~80 chars OR before the next `;`, whichever is closer." The 80-char
 * window is generous enough that a developer who writes
 * `date_trunc('day', x at time zone 'America/Chicago')` always satisfies it;
 * a sibling-statement `at time zone` after a `;` is correctly excluded.
 */
const AT_TZ_WINDOW = 80;
const AT_TZ_RE = /\bat\s+time\s+zone\b/i;

/**
 * @typedef {Object} Finding
 * @property {string} file   - Repo-relative path (POSIX separators).
 * @property {number} line   - 1-based line number of the match start.
 * @property {number} col    - 1-based column of the match start.
 * @property {string} expr   - The matched `date_trunc(...)` substring.
 * @property {string} reason - Human-readable reason; ADR reference.
 */

const REASON =
  'date_trunc(day|hour|week|month, ...) without at time zone — ADR-0034 §Storage and database rules';

/**
 * Strips SQL comments (line `-- ...` and block `/* ... *\/`) from `sql` while
 * preserving offsets — comments are replaced with whitespace of equal length
 * (newlines preserved inside block comments) so character positions, line
 * numbers, and column numbers stay aligned with the original source. The
 * line/col reporter uses positions in the stripped text; mapping those back
 * to the raw SQL is therefore a no-op.
 *
 * @param {string} sql
 * @returns {string}
 */
export function stripSqlComments(sql) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    // Line comment: `-- ...` until end-of-line.
    if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') {
        out += ' ';
        i++;
      }
      // Preserve the newline if present.
      if (i < sql.length && sql[i] === '\n') {
        out += '\n';
        i++;
      }
      continue;
    }
    // Block comment: `/* ... */`. Nested block comments are not part of
    // standard SQL and not handled here.
    if (ch === '/' && next === '*') {
      out += '  '; // replace the opening `/*`
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) {
        out += sql[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < sql.length) {
        out += '  '; // replace the closing `*/`
        i += 2;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Returns true when `at time zone` appears within the proximity window after
 * `matchEnd` in the (comment-stripped) `sql`. The window is the minimum of
 * `AT_TZ_WINDOW` characters or the next `;` (sibling statement boundary).
 *
 * @param {string} sql
 * @param {number} matchEnd  - Offset immediately after the `date_trunc(...)` match.
 * @returns {boolean}
 */
function hasAtTimeZoneNearby(sql, matchEnd) {
  const semiIdx = sql.indexOf(';', matchEnd);
  const windowEnd =
    semiIdx === -1
      ? Math.min(sql.length, matchEnd + AT_TZ_WINDOW)
      : Math.min(semiIdx, matchEnd + AT_TZ_WINDOW);
  const slice = sql.slice(matchEnd, windowEnd);
  return AT_TZ_RE.test(slice);
}

/**
 * Computes (1-based) line and column for a 0-based offset into `text`.
 *
 * @param {string} text
 * @param {number} offset
 * @returns {{ line: number, col: number }}
 */
function lineColFor(text, offset) {
  let line = 1;
  let col = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

/**
 * Within `inner` (the text inside `date_trunc(...)`), `at time zone` is also
 * acceptable. The match's `at time zone` may appear either inside the call
 * (`date_trunc('day', x at time zone 'America/Chicago')`) or after it on the
 * same expression. The regex `DATE_TRUNC_RE` greedy-matches up to the closing
 * `)`, so the inner check is handled by inspecting the matched substring
 * itself — if `at time zone` is inside the parentheses, the substring will
 * contain it and we accept.
 *
 * @param {string} matchText
 * @returns {boolean}
 */
function hasAtTimeZoneInside(matchText) {
  return AT_TZ_RE.test(matchText);
}

/**
 * Scans a single SQL `rawSql` (with comments) and returns findings. Strips
 * comments first so a regex match inside a comment does not register.
 *
 * @param {string} relPath
 * @param {string} rawSql
 * @returns {Finding[]}
 */
export function scanSqlSource(relPath, rawSql) {
  const sql = stripSqlComments(rawSql);
  /** @type {Finding[]} */
  const findings = [];
  // Reset lastIndex defensively — the regex has the /g flag and is module-scoped.
  DATE_TRUNC_RE.lastIndex = 0;
  let m;
  while ((m = DATE_TRUNC_RE.exec(sql)) !== null) {
    const matchText = m[0];
    const matchStart = m.index;
    const matchEnd = matchStart + matchText.length;
    if (hasAtTimeZoneInside(matchText)) continue;
    if (hasAtTimeZoneNearby(sql, matchEnd)) continue;
    const { line, col } = lineColFor(sql, matchStart);
    findings.push({
      file: relPath,
      line,
      col,
      expr: matchText,
      reason: REASON,
    });
  }
  return findings;
}

/**
 * Returns true if `relPath` matches `scope` glob. We support a tiny subset of
 * glob: a trailing `/**` matches any path under the prefix; otherwise `===`.
 * The default scope `db/queries/reports/**` exercises the trailing-`/**` arm.
 *
 * Paths are normalized to POSIX separators before matching so Windows runners
 * behave identically to Linux.
 *
 * @param {string} relPath  - POSIX-separator repo-relative path.
 * @param {string} scope
 * @returns {boolean}
 */
function pathMatchesScope(relPath, scope) {
  const normScope = scope.split(sep).join(posix.sep);
  const normPath = relPath.split(sep).join(posix.sep);
  if (normScope.endsWith('/**')) {
    const prefix = normScope.slice(0, -3); // drop the `/**`
    if (prefix === '' || prefix === '.') return true;
    return normPath === prefix || normPath.startsWith(prefix + '/');
  }
  return normPath === normScope;
}

/**
 * Recursively walks `dirAbs`, returning every `.sql` file's absolute path.
 * Symlinks are not followed (defense-in-depth; the test fixtures are plain
 * files anyway).
 *
 * @param {string} dirAbs
 * @returns {string[]}
 */
function walkSqlFiles(dirAbs) {
  if (!existsSync(dirAbs)) return [];
  /** @type {string[]} */
  const out = [];
  const stack = [dirAbs];
  while (stack.length > 0) {
    const cur = stack.pop();
    const entries = readdirSync(cur, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile() && entry.name.endsWith('.sql')) {
        out.push(abs);
      }
    }
  }
  return out;
}

/**
 * Programmatic API. Lints SQL files under `scope` (default `SCOPE`) OR an
 * explicit `files` list. Either argument is optional; if `files` is provided,
 * only those files are scanned.
 *
 * **`files` behavior:** when `files` is provided, the listed files are
 * scanned regardless of whether they match `scope`. This is the test seam:
 * a test passes an explicit list of fixture paths and asserts the resulting
 * findings. When `files` is omitted, the lint walks the directory root
 * derived from `scope` and scans every `.sql` file under it that matches the
 * glob. This means:
 *
 *   - CI / default CLI: `files` omitted, `scope` omitted → recurse
 *     `db/queries/reports/**` from `REPO_ROOT`.
 *   - Test "scope respected (default)": `scope: <fixtures-root-with-glob>` →
 *     scan only files under that root that match the glob.
 *   - Test "scope override": `files: [<abs-path>]` → scan that file directly
 *     regardless of glob.
 *
 * @param {{ scope?: string, files?: string[], cwd?: string }} [opts]
 * @returns {Finding[]}
 */
export function lintSqlDayBucket(opts = {}) {
  const cwd = opts.cwd ?? REPO_ROOT;
  /** @type {Finding[]} */
  const findings = [];
  /** @type {string[]} */
  let absFiles;
  if (opts.files && opts.files.length > 0) {
    absFiles = opts.files.map((f) => resolve(cwd, f));
  } else {
    const scope = opts.scope ?? SCOPE;
    let scopeRootAbs;
    if (scope.endsWith('/**')) {
      const prefix = scope.slice(0, -3);
      scopeRootAbs = resolve(cwd, prefix);
    } else {
      scopeRootAbs = resolve(cwd, scope);
    }
    if (existsSync(scopeRootAbs) && statSync(scopeRootAbs).isDirectory()) {
      absFiles = walkSqlFiles(scopeRootAbs).filter((abs) => {
        const rel = relative(cwd, abs).split(sep).join(posix.sep);
        return pathMatchesScope(rel, scope);
      });
    } else if (existsSync(scopeRootAbs) && scopeRootAbs.endsWith('.sql')) {
      absFiles = [scopeRootAbs];
    } else {
      absFiles = [];
    }
  }
  for (const abs of absFiles) {
    if (!existsSync(abs)) continue;
    const rel = relative(cwd, abs).split(sep).join(posix.sep);
    const sql = readFileSync(abs, 'utf8');
    const fileFindings = scanSqlSource(rel, sql);
    findings.push(...fileFindings);
  }
  return findings;
}

/**
 * Formats findings as a human-readable report matching
 * `scripts/check-migration-safety.mjs`'s style.
 *
 * @param {Finding[]} findings
 * @returns {string}
 */
export function formatFindings(findings) {
  if (findings.length === 0) return '';
  const lines = [];
  lines.push('SQL day-bucket lint findings (see ADR-0034 §Storage and database rules):');
  for (const f of findings) {
    lines.push(`  - ${f.file}:${f.line}:${f.col}`);
    lines.push(`      expr: ${f.expr}`);
    lines.push(`      reason: ${f.reason}`);
  }
  return lines.join('\n');
}

/* ----------------------------- entry point ----------------------------- */

function main() {
  const findings = lintSqlDayBucket();
  if (findings.length === 0) {
    console.log(`No findings — scanned scope \`${SCOPE}\`.`);
    return 0;
  }
  console.log(formatFindings(findings));
  console.error(`\nSQL day-bucket lint FAILED with ${findings.length} finding(s).`);
  return 1;
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isMainModule) {
  process.exit(main());
}
