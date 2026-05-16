// tests/lint/no-naked-date.test.ts — AC4 sub-cases for the
// ADR-0034 ESLint `no-restricted-syntax` rule that forbids
// naked `new Date()` / `Date.now()` outside `lib/time/`,
// `tests/`, and `scripts/`.
//
// The test invokes ESLint programmatically (NOT via `pnpm lint`) so it
// can target individual fixture files without scanning the whole repo.
//
// Materialization strategy: the canonical fixture files live under
// `tests/lint/_fixtures/` — but `tests/` is in the override glob (rule
// disabled), so linting the fixtures in place would never fire the
// rule. To exercise both the FIRING path (sub-cases 2 + 3) and the
// OVERRIDE-EFFECTIVE path (sub-case 5), the test reads each fixture
// as raw text and writes it to a tmp path:
//
//   - sub-cases 1-4: tmp path under `_tmp/lint-no-naked-date/<run-id>/`
//     at the repo root. That path is OUTSIDE every override glob, so
//     the rule applies as configured.
//   - sub-case 5: tmp path under `lib/time/_tmp-fixtures/<run-id>/`.
//     That path IS inside the `lib/time/` override glob, so the rule
//     MUST NOT fire — proving the override is load-bearing.
//
// Tmp paths are nested under fresh per-run directories and removed in
// `afterAll` so concurrent vitest runs / repeated invocations do not
// collide.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ESLint } from 'eslint';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const FIXTURES_DIR = resolve(__dirname, '_fixtures');

const RUN_ID = `run-${process.pid}-${Date.now()}`;
const TMP_ROOT_OUTSIDE = join(REPO_ROOT, '_tmp', 'lint-no-naked-date', RUN_ID);
const TMP_ROOT_LIB_TIME = join(REPO_ROOT, 'lib', 'time', '_tmp-fixtures', RUN_ID);

/**
 * Target paths for each sub-case fixture. Materialized once in
 * `beforeAll` so typescript-eslint's Program (built lazily on the
 * first lintFiles call) includes ALL fixture files. If a fixture were
 * materialized lazily per sub-case, sub-cases that run after the first
 * lintFiles call would emit a "file not in tsconfig project" parser
 * error and skip rule evaluation entirely — masking the real assertion.
 * See `tests/lint/no-naked-date.test.ts` history for the CI flake this
 * change fixed (Linux Node ICU + caching, not reproducible on Windows).
 */
const FIXTURE_TARGETS: ReadonlyArray<{ source: string; target: string }> = [
  { source: 'uses-now-utc.ts', target: join(TMP_ROOT_OUTSIDE, 'uses-now-utc.ts') },
  { source: 'uses-naked-new-date.ts', target: join(TMP_ROOT_OUTSIDE, 'uses-naked-new-date.ts') },
  { source: 'uses-naked-date-now.ts', target: join(TMP_ROOT_OUTSIDE, 'uses-naked-date-now.ts') },
  { source: 'uses-date-with-arg.ts', target: join(TMP_ROOT_OUTSIDE, 'uses-date-with-arg.ts') },
  {
    source: 'naked-allowed-template.ts.skip',
    target: join(TMP_ROOT_LIB_TIME, 'naked-allowed.ts'),
  },
];

/**
 * Read a canonical fixture from `tests/lint/_fixtures/` and materialize
 * its raw text at `targetPath`. Creates intermediate directories.
 */
function materializeFixture(sourceFile: string, targetPath: string): void {
  const sourceAbs = resolve(FIXTURES_DIR, sourceFile);
  const text = readFileSync(sourceAbs, 'utf-8');
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, text, 'utf-8');
}

/**
 * Run ESLint with `cwd: repoRoot` against a single file. Returns the
 * lint messages for that file.
 */
async function lintFile(absPath: string): Promise<ESLint.LintResult[]> {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  return eslint.lintFiles([absPath]);
}

/**
 * Helper: does any message on the result reference the
 * `no-restricted-syntax` rule?
 */
function hasNoRestrictedSyntaxFinding(results: ESLint.LintResult[]): boolean {
  return results.some((r) => r.messages.some((m) => m.ruleId === 'no-restricted-syntax'));
}

beforeAll(() => {
  mkdirSync(TMP_ROOT_OUTSIDE, { recursive: true });
  mkdirSync(TMP_ROOT_LIB_TIME, { recursive: true });
  // Materialize ALL fixtures up front. typescript-eslint v8 caches the
  // TypeScript Program after the first lintFiles call; files written
  // post-cache are flagged "not in project" and skip rule evaluation,
  // which would make sub-cases 2 and 3 falsely return no findings.
  for (const { source, target } of FIXTURE_TARGETS) {
    materializeFixture(source, target);
  }
});

afterAll(() => {
  // Clean up tmp roots — both run-scoped subdirs.
  if (existsSync(TMP_ROOT_OUTSIDE)) {
    rmSync(TMP_ROOT_OUTSIDE, { recursive: true, force: true });
  }
  if (existsSync(TMP_ROOT_LIB_TIME)) {
    rmSync(TMP_ROOT_LIB_TIME, { recursive: true, force: true });
  }
  // Best-effort cleanup of empty parent directories so we don't leave
  // `_tmp/lint-no-naked-date/` and `lib/time/_tmp-fixtures/` empty
  // shells. We attempt recursive removal but suppress any failure (in
  // particular, on Windows a concurrent vitest worker may be using the
  // same parent dir).
  for (const parent of [
    join(REPO_ROOT, '_tmp', 'lint-no-naked-date'),
    join(REPO_ROOT, 'lib', 'time', '_tmp-fixtures'),
    join(REPO_ROOT, '_tmp'),
  ]) {
    try {
      rmSync(parent, { recursive: true, force: true });
    } catch {
      // Non-empty (concurrent run) or already removed — ignore.
    }
  }
});

describe('no-naked-date ESLint rule — AC4 sub-cases', () => {
  // ───────────────────────────────────────────────────────────────────
  // Sub-case 1: lint-PASS on uses-now-utc.ts (calls nowUtc(), no naked
  // Date constructor).
  // ───────────────────────────────────────────────────────────────────
  it('sub-case 1: lint passes on uses-now-utc.ts (sanctioned helper)', async () => {
    const target = join(TMP_ROOT_OUTSIDE, 'uses-now-utc.ts');
    materializeFixture('uses-now-utc.ts', target);
    const results = await lintFile(target);
    expect(hasNoRestrictedSyntaxFinding(results)).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────
  // Sub-case 2: lint-FAIL on uses-naked-new-date.ts — the zero-arg
  // `new Date()` MUST trigger the rule. Materialized outside the
  // override globs so the rule is in effect.
  // ───────────────────────────────────────────────────────────────────
  it('sub-case 2: lint fails on uses-naked-new-date.ts with no-restricted-syntax', async () => {
    const target = join(TMP_ROOT_OUTSIDE, 'uses-naked-new-date.ts');
    materializeFixture('uses-naked-new-date.ts', target);
    const results = await lintFile(target);
    expect(hasNoRestrictedSyntaxFinding(results)).toBe(true);
    const noRestrictedMsgs = results
      .flatMap((r) => r.messages)
      .filter((m) => m.ruleId === 'no-restricted-syntax');
    expect(noRestrictedMsgs.length).toBeGreaterThan(0);
    expect(noRestrictedMsgs[0]!.message).toMatch(/nowUtc\(\)/);
  });

  // ───────────────────────────────────────────────────────────────────
  // Sub-case 3: lint-FAIL on uses-naked-date-now.ts — the
  // `Date.now()` call MUST trigger the rule.
  // ───────────────────────────────────────────────────────────────────
  it('sub-case 3: lint fails on uses-naked-date-now.ts with no-restricted-syntax', async () => {
    const target = join(TMP_ROOT_OUTSIDE, 'uses-naked-date-now.ts');
    materializeFixture('uses-naked-date-now.ts', target);
    const results = await lintFile(target);
    expect(hasNoRestrictedSyntaxFinding(results)).toBe(true);
    const noRestrictedMsgs = results
      .flatMap((r) => r.messages)
      .filter((m) => m.ruleId === 'no-restricted-syntax');
    expect(noRestrictedMsgs.length).toBeGreaterThan(0);
    expect(noRestrictedMsgs[0]!.message).toMatch(/nowUtc\(\)/);
  });

  // ───────────────────────────────────────────────────────────────────
  // Sub-case 4: lint-PASS on uses-date-with-arg.ts — `new Date(<arg>)`
  // with ≥1 argument is permitted everywhere (the AST selector only
  // matches the zero-argument form).
  // ───────────────────────────────────────────────────────────────────
  it('sub-case 4: lint passes on uses-date-with-arg.ts (arg-bearing constructor)', async () => {
    const target = join(TMP_ROOT_OUTSIDE, 'uses-date-with-arg.ts');
    materializeFixture('uses-date-with-arg.ts', target);
    const results = await lintFile(target);
    expect(hasNoRestrictedSyntaxFinding(results)).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────
  // Sub-case 5: lint-PASS on the naked-`new Date()` template once
  // materialized UNDER `lib/time/` — proves the `lib/time/**/*.ts`
  // override glob is effective. Same source text as sub-case 2 but
  // copied to a different path.
  // ───────────────────────────────────────────────────────────────────
  it('sub-case 5: lint passes when naked new Date() is materialized under lib/time/ (override glob)', async () => {
    const target = join(TMP_ROOT_LIB_TIME, 'naked-allowed.ts');
    materializeFixture('naked-allowed-template.ts.skip', target);
    const results = await lintFile(target);
    expect(hasNoRestrictedSyntaxFinding(results)).toBe(false);
  });
});
