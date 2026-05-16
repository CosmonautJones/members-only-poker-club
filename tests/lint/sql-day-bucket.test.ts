import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  lintSqlDayBucket,
  scanSqlSource,
  stripSqlComments,
  SCOPE,
  // @ts-expect-error — .mjs source, types are resolved at runtime
} from '../../scripts/lint/sql-day-bucket.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const FIXTURES_DIR = resolve(__dirname, '_fixtures', 'sql');

type Finding = {
  file: string;
  line: number;
  col: number;
  expr: string;
  reason: string;
};

function fixture(name: string): string {
  return resolve(FIXTURES_DIR, name);
}

describe('sql-day-bucket lint — AC8 sub-cases', () => {
  // ───────────────────────────────────────────────────────────────────────
  // Sub-case 1 — clean: at time zone inside date_trunc → no findings.
  // ───────────────────────────────────────────────────────────────────────
  it('produces no findings on clean fixture (date_trunc with at time zone inside)', () => {
    const findings: Finding[] = lintSqlDayBucket({
      cwd: REPO_ROOT,
      files: [fixture('clean.sql')],
    });
    expect(findings).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Sub-case 2 — naked day: exactly one finding pointing at the line.
  // ───────────────────────────────────────────────────────────────────────
  it("flags naked date_trunc('day', x) with exactly one finding", () => {
    const findings: Finding[] = lintSqlDayBucket({
      cwd: REPO_ROOT,
      files: [fixture('naked-day.sql')],
    });
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f).toMatchObject({
      reason: expect.stringContaining('ADR-0034'),
    });
    expect(f.expr.toLowerCase()).toContain("date_trunc('day'");
    // Path is repo-relative and POSIX-normalized.
    expect(f.file).toMatch(/tests\/lint\/_fixtures\/sql\/naked-day\.sql$/);
    // Line/col point at the date_trunc call.
    expect(f.line).toBeGreaterThan(0);
    expect(f.col).toBeGreaterThan(0);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Sub-case 3 — naked hour / week / month: one finding each.
  // ───────────────────────────────────────────────────────────────────────
  it("flags naked date_trunc('hour', x)", () => {
    const findings: Finding[] = lintSqlDayBucket({
      cwd: REPO_ROOT,
      files: [fixture('naked-hour.sql')],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.expr.toLowerCase()).toContain("date_trunc('hour'");
  });

  it("flags naked date_trunc('week', x)", () => {
    const findings: Finding[] = lintSqlDayBucket({
      cwd: REPO_ROOT,
      files: [fixture('naked-week.sql')],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.expr.toLowerCase()).toContain("date_trunc('week'");
  });

  it("flags naked date_trunc('month', x)", () => {
    const findings: Finding[] = lintSqlDayBucket({
      cwd: REPO_ROOT,
      files: [fixture('naked-month.sql')],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.expr.toLowerCase()).toContain("date_trunc('month'");
  });

  // ───────────────────────────────────────────────────────────────────────
  // Sub-case 4 — line-comment-stripped: pattern inside `-- ...` ignored.
  // ───────────────────────────────────────────────────────────────────────
  it('ignores date_trunc patterns inside line comments', () => {
    const findings: Finding[] = lintSqlDayBucket({
      cwd: REPO_ROOT,
      files: [fixture('comment-stripped.sql')],
    });
    expect(findings).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Sub-case 5 — block-comment-stripped: pattern inside /* ... */ ignored.
  // ───────────────────────────────────────────────────────────────────────
  it('ignores date_trunc patterns inside block comments', () => {
    const findings: Finding[] = lintSqlDayBucket({
      cwd: REPO_ROOT,
      files: [fixture('block-comment-stripped.sql')],
    });
    expect(findings).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Sub-case 6 — scope respected (the load-bearing filter):
  //   default scope (`db/queries/reports/**`) does NOT visit the
  //   fixture file at `tests/lint/_fixtures/sql/out-of-scope/out-of-scope.sql`;
  //   an explicit override that includes it DOES visit it.
  // ───────────────────────────────────────────────────────────────────────
  it('does NOT scan files outside the default scope (db/queries/reports/**)', () => {
    // Default scope from the SCOPE constant; cwd is REPO_ROOT. The actual
    // `db/queries/reports/` directory does not exist in the working tree
    // yet (it lands with ADR-0034's downstream cycles), so the walk yields
    // nothing — and critically, the lint does NOT venture into
    // `tests/lint/_fixtures/sql/out-of-scope/` even though that path
    // contains a violating fixture.
    const findings: Finding[] = lintSqlDayBucket({ cwd: REPO_ROOT });
    // Whatever findings are produced, NONE may point at the out-of-scope
    // fixture (the assertion is the scope filter, not the absence of
    // unrelated findings — if a future commit lands a violating SQL under
    // `db/queries/reports/**`, that's a separate bug, not a regression here).
    const fromOutOfScope = findings.filter((f) => f.file.includes('out-of-scope'));
    expect(fromOutOfScope).toEqual([]);
  });

  it('exports the SCOPE constant set to db/queries/reports/**', () => {
    expect(SCOPE).toBe('db/queries/reports/**');
  });

  it('DOES scan out-of-scope fixture when explicit `files` override includes it', () => {
    const findings: Finding[] = lintSqlDayBucket({
      cwd: REPO_ROOT,
      files: [fixture('out-of-scope/out-of-scope.sql')],
    });
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.file).toMatch(/out-of-scope\/out-of-scope\.sql$/);
    expect(f.expr.toLowerCase()).toContain("date_trunc('day'");
  });

  // ───────────────────────────────────────────────────────────────────────
  // Sub-case 7 — `at time zone` in a sibling statement (after `;`) does
  // NOT satisfy the proximity check. Tightens the heuristic.
  // ───────────────────────────────────────────────────────────────────────
  it('reports a finding when `at time zone` is only in a sibling statement after `;`', () => {
    const findings: Finding[] = lintSqlDayBucket({
      cwd: REPO_ROOT,
      files: [fixture('at-time-zone-in-sibling.sql')],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.expr.toLowerCase()).toContain("date_trunc('day'");
  });
});

describe('sql-day-bucket lint — internals', () => {
  it('stripSqlComments preserves offsets (replaces with same-length whitespace)', () => {
    const input = 'select x; -- comment here\nselect y;';
    const stripped = stripSqlComments(input);
    expect(stripped.length).toBe(input.length);
    // The "select x;" prefix is preserved verbatim.
    expect(stripped.startsWith('select x; ')).toBe(true);
    // The comment is gone (replaced with spaces).
    expect(stripped).not.toContain('comment here');
    // Lines are preserved.
    expect(stripped.split('\n')).toHaveLength(2);
  });

  it('stripSqlComments handles block comments with newlines (preserves newlines)', () => {
    const input = 'select x;\n/* block\n comment */\nselect y;';
    const stripped = stripSqlComments(input);
    expect(stripped.length).toBe(input.length);
    expect(stripped.split('\n')).toHaveLength(4);
    expect(stripped).not.toContain('block');
    expect(stripped).not.toContain('comment');
  });

  it('scanSqlSource finds a single violation in inline SQL', () => {
    const findings: Finding[] = scanSqlSource(
      'inline.sql',
      "select date_trunc('day', created_at) from x;",
    );
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.file).toBe('inline.sql');
    expect(f.line).toBe(1);
  });

  it('scanSqlSource accepts inline `at time zone` inside the date_trunc body', () => {
    const findings: Finding[] = scanSqlSource(
      'inline.sql',
      "select date_trunc('day', x at time zone 'America/Chicago') from t;",
    );
    expect(findings).toEqual([]);
  });

  it('scanSqlSource catches multiple violations in one file', () => {
    const findings: Finding[] = scanSqlSource(
      'inline.sql',
      "select date_trunc('day', a) from t; select date_trunc('month', b) from t2;",
    );
    expect(findings).toHaveLength(2);
  });
});
