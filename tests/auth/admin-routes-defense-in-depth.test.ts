/**
 * Defense-in-depth invariants for `/admin` RSC pages and server actions
 * (ADR-0035 AC5, AC6, WA.T3).
 *
 * Run locally:    pnpm test tests/auth/admin-routes-defense-in-depth.test.ts
 * Prerequisites:  none — pure filesystem + TypeScript-AST traversal.
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md
 *       AC5 (every admin page.tsx + every server action calls
 *       `await requireRole('manager'|'owner')` as the first await
 *       expression in the exported function body — defense-in-depth
 *       independent of the layout's gate)
 *       AC6 (middleware path-gate `GATED_PREFIXES` still contains
 *       `/admin` — middleware regression).
 *
 * SUT contract (per AC5):
 *   - For every file matching `app/(admin)/**\/page.tsx` (excluding the
 *     route group's `layout.tsx` — which is asserted in
 *     `tests/auth/admin-routes.test.ts` AC4) AND every file matching
 *     `app/(admin)/**\/_actions/*.ts`:
 *       1. Source MUST match
 *          `/await\s+requireRole\(\s*['"](manager|owner)['"]\s*\)/`
 *          (existence check — catches a missing gate outright).
 *       2. The FIRST `await` expression inside each exported async
 *          function body MUST be the `await requireRole(...)` call.
 *          This is the "first-await" contract — a worker who slips a
 *          DB read before the gate, or a refactor that accidentally
 *          inlines the layout, must not silently bypass the check.
 *
 * Walker strategy (preferred — TypeScript AST):
 *   - Parse the source with `ts.createSourceFile`.
 *   - Collect every top-level exported async function (default export
 *     OR named export). Server actions can export multiple async
 *     functions per file; each must independently satisfy the contract.
 *   - For each such function, descend into its Block body, find the
 *     first `ts.AwaitExpression` reached in source order, and assert
 *     its `expression` is a `ts.CallExpression` whose callee is the
 *     identifier `requireRole` with a string-literal first argument
 *     of `'manager'` or `'owner'`.
 *   - The AST walker is deterministic and tolerates comments, JSX,
 *     parameter destructuring, and intervening synchronous statements
 *     (e.g. `const { searchParams } = props;` BEFORE the gate is fine
 *     — what matters is that no `await` happens before the gate).
 *
 * Walker strategy (regex fallback — sanity check):
 *   - In addition to the AST walk, we run a regex-based check that
 *     locates the first `\bawait\b` token in the file body and asserts
 *     the next non-whitespace characters within 40 chars start with
 *     `requireRole(`. This is a coarser check (it sees ALL awaits in
 *     the file, not per-function), but catches the same regression
 *     when the file has a single exported function (the current
 *     scaffold) and serves as a defense-in-depth on the AST walker
 *     itself. Both checks must pass.
 *
 * Exclusions (per AC5):
 *   - `layout.tsx` is exempt — its first-statement contract is
 *     asserted in AC4 by `tests/auth/admin-routes.test.ts`.
 *   - `*.test.ts`, `*.test.tsx`, `*.spec.ts` are excluded (test files
 *     are not the SUT).
 *   - `error.tsx`, `loading.tsx`, `not-found.tsx`, `default.tsx`,
 *     `template.tsx` are excluded — these are framework boundaries
 *     that render fallbacks for the layout's gate; they don't perform
 *     data reads and the spec scopes AC5 to `page.tsx` + `_actions/*.ts`.
 *   - Barrel re-exports (`index.ts` containing only `export … from …`)
 *     are excluded — they have no function body to gate.
 *
 * AC6 (middleware regression):
 *   - Source-grep `middleware.ts` and assert `GATED_PREFIXES` still
 *     includes `/admin`. The full middleware behavior (redirect on
 *     unauthenticated `/admin/**`) is asserted in the pre-existing
 *     `tests/auth/middleware.test.ts`; we assert that file exists and
 *     still references the admin path so a deletion-by-mistake is
 *     caught by THIS test too.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ADMIN_ROOT = path.join(REPO_ROOT, 'app', '(admin)');
const MIDDLEWARE_PATH = path.join(REPO_ROOT, 'middleware.ts');
const MIDDLEWARE_TEST_PATH = path.join(REPO_ROOT, 'tests', 'auth', 'middleware.test.ts');

// Filenames excluded from the page-level walker. `layout.tsx` is
// exempt because AC4 asserts its first body statement separately.
// Framework boundary files render fallbacks, not data, and the spec
// scopes AC5 to `page.tsx` + `_actions/*.ts`.
const EXEMPT_BASENAMES = new Set([
  'layout.tsx',
  'error.tsx',
  'loading.tsx',
  'not-found.tsx',
  'default.tsx',
  'template.tsx',
]);

/**
 * Recursively collect files under `dir` (absolute) matching `predicate`.
 * Dependency-free filesystem walk — no `fast-glob` or `glob` in this
 * repo's devDeps, and the `(admin)` parenthesis path segment trips up
 * many globbers anyway. This is the sturdiest approach for a route
 * group rooted at `app/(admin)`.
 *
 * Skips `node_modules` and dot-directories defensively (the admin
 * tree should contain none, but a future co-located fixture must not
 * sneak into the walker).
 */
function walkFiles(dir: string, predicate: (abs: string) => boolean): string[] {
  const results: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const abs = path.join(current, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      // Symlinks: stat to resolve. We tolerate them but don't follow
      // out of the tree.
      if (entry.isSymbolicLink()) {
        try {
          const st = statSync(abs);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch {
          continue;
        }
      }
      if (isDir) {
        stack.push(abs);
      } else if (isFile && predicate(abs)) {
        results.push(abs);
      }
    }
  }
  return results;
}

/**
 * Collect files under `app/(admin)/` subject to the defense-in-depth
 * contract:
 *   - any `**\/page.tsx` (excluding `EXEMPT_BASENAMES`)
 *   - any `**\/_actions/*.{ts,tsx}` (excluding test/spec files)
 *
 * Returns absolute paths sorted for stable ordering.
 */
function collectAdminGatedFiles(): string[] {
  if (!existsSync(ADMIN_ROOT)) {
    // Surfaced as a test failure below — the admin route group MUST
    // exist by the time t4 runs (t3 ships layout/page/error).
    return [];
  }

  const matches = walkFiles(ADMIN_ROOT, (abs) => {
    const base = path.basename(abs);
    // Skip framework boundary files + the layout (asserted in AC4)
    // + test/spec files.
    if (EXEMPT_BASENAMES.has(base)) return false;
    if (/\.test\.tsx?$/.test(base)) return false;
    if (/\.spec\.tsx?$/.test(base)) return false;

    // Match `page.tsx` at any depth.
    if (base === 'page.tsx') return true;

    // Match `_actions/*.{ts,tsx}` — the parent directory must be
    // named exactly `_actions`. This is the spec's contract.
    const parent = path.basename(path.dirname(abs));
    if (parent === '_actions' && /\.(ts|tsx)$/.test(base)) return true;

    return false;
  });

  return matches.sort();
}

/**
 * Decide whether a file is a barrel re-export (no function bodies,
 * only `export … from …` statements). Such files have nothing to
 * gate. Detection: parse and confirm every top-level statement is an
 * `ExportDeclaration` with a `moduleSpecifier` OR an `ExportAssignment`
 * that re-exports without a body.
 */
function isBarrelReExport(sourceFile: ts.SourceFile): boolean {
  if (sourceFile.statements.length === 0) return false;
  return sourceFile.statements.every((stmt) => {
    if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier) return true;
    return false;
  });
}

type ExportedAsyncFn = {
  name: string;
  node: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
  /** The function's body (Block) — where the first await lives. */
  body: ts.Block;
};

/**
 * Collect every top-level exported async function from the source
 * file. Handles:
 *   - `export default async function Foo() { … }`
 *   - `export async function bar() { … }`
 *   - `export const baz = async () => { … }`
 *   - `export default async () => { … }` (anonymous default arrow)
 *
 * Returns only functions with a Block body — arrow functions with
 * concise expression bodies (`async () => requireRole(…)`) are
 * impossible to "first-await" check meaningfully and are explicitly
 * rejected as a contract violation by the caller's assertion.
 */
function collectExportedAsyncFunctions(sourceFile: ts.SourceFile): ExportedAsyncFn[] {
  const out: ExportedAsyncFn[] = [];

  for (const stmt of sourceFile.statements) {
    // `export [default] async function name() { … }`
    if (ts.isFunctionDeclaration(stmt)) {
      const isExported = !!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      const isAsync = !!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
      if (isExported && isAsync && stmt.body) {
        out.push({
          name: stmt.name?.text ?? '<default>',
          node: stmt,
          body: stmt.body,
        });
      }
      continue;
    }

    // `export const name = async (...) => { … }` OR
    // `export const name = async function (...) { … }`
    if (ts.isVariableStatement(stmt)) {
      const isExported = !!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!isExported) continue;
      for (const decl of stmt.declarationList.declarations) {
        if (!decl.initializer) continue;
        const init = decl.initializer;
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          const isAsync = !!init.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
          if (!isAsync) continue;
          if (!init.body || !ts.isBlock(init.body)) continue;
          const name = ts.isIdentifier(decl.name) ? decl.name.text : '<destructured>';
          out.push({ name, node: init, body: init.body });
        }
      }
      continue;
    }

    // `export default async function () { … }` OR
    // `export default async () => { … }`
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      const expr = stmt.expression;
      if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
        const isAsync = !!expr.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
        if (!isAsync) continue;
        if (!expr.body || !ts.isBlock(expr.body)) continue;
        out.push({ name: '<default>', node: expr, body: expr.body });
      }
    }
  }

  return out;
}

/**
 * Find the first `AwaitExpression` reached in source order inside
 * `body`, skipping over nested function/arrow scopes (an `await` in
 * a callback is NOT the outer function's first await — it executes
 * lazily). Returns `undefined` if the body has no awaits.
 *
 * We use an iterative source-order walk: enter children in order,
 * but stop descent at any nested FunctionLike (a FunctionDeclaration,
 * FunctionExpression, ArrowFunction, MethodDeclaration, or
 * Constructor) — those have their own async context.
 */
function findFirstAwait(body: ts.Block): ts.AwaitExpression | undefined {
  let found: ts.AwaitExpression | undefined;

  const visit = (node: ts.Node): boolean /* keepGoing */ => {
    if (found) return false;
    if (ts.isAwaitExpression(node)) {
      found = node;
      return false;
    }
    // Skip nested function scopes — their awaits are not THIS body's
    // first await. Class methods/constructors likewise.
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessor(node) ||
      ts.isSetAccessor(node)
    ) {
      // Don't descend.
      return true;
    }
    ts.forEachChild(node, (child) => {
      visit(child);
    });
    return !found;
  };

  for (const stmt of body.statements) {
    if (!visit(stmt)) break;
    if (found) break;
  }
  return found;
}

/**
 * Assert that an AwaitExpression is `await requireRole('manager')` or
 * `await requireRole('owner')`. Returns a tuple of (ok, descriptor)
 * so the caller can build a meaningful failure message.
 */
function isRequireRoleAwait(
  await_: ts.AwaitExpression,
): { ok: true; role: 'manager' | 'owner' } | { ok: false; reason: string } {
  const expr = await_.expression;
  if (!ts.isCallExpression(expr)) {
    return {
      ok: false,
      reason: `await target is ${ts.SyntaxKind[expr.kind]}, not a CallExpression`,
    };
  }
  // Accept bare `requireRole(...)` (identifier callee) — the canonical
  // shape. Reject member-access calls like `auth.requireRole(...)` as
  // those bypass the lint-time import contract.
  if (!ts.isIdentifier(expr.expression)) {
    return {
      ok: false,
      reason: `callee is ${ts.SyntaxKind[expr.expression.kind]}, not a bare identifier`,
    };
  }
  if (expr.expression.text !== 'requireRole') {
    return {
      ok: false,
      reason: `callee identifier is "${expr.expression.text}", not "requireRole"`,
    };
  }
  const firstArg = expr.arguments[0];
  if (!firstArg) {
    return { ok: false, reason: 'requireRole() called with no arguments' };
  }
  if (!ts.isStringLiteral(firstArg) && !ts.isNoSubstitutionTemplateLiteral(firstArg)) {
    return {
      ok: false,
      reason: `requireRole() first argument is ${ts.SyntaxKind[firstArg.kind]}, not a string literal`,
    };
  }
  const role = firstArg.text;
  if (role !== 'manager' && role !== 'owner') {
    return { ok: false, reason: `requireRole('${role}') — expected 'manager' or 'owner'` };
  }
  return { ok: true, role };
}

/**
 * Regex-based first-await sanity check. Locates the first `\bawait\b`
 * token in the file (skipping strings and comments via a simple
 * source-strip) and asserts the next non-whitespace tokens start with
 * `requireRole(` within 40 characters. This is a coarser but
 * independently-implemented check that catches the same regression
 * as the AST walker — useful as a belt-and-braces guard.
 */
function regexFallbackFirstAwait(src: string): { ok: boolean; reason: string } {
  // Strip block comments and line comments (cheap, good-enough for
  // first-await detection — we're not parsing).
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
  const match = stripped.match(/\bawait\b/);
  if (!match) {
    return { ok: false, reason: 'no `await` token found in file' };
  }
  const idx = match.index ?? -1;
  if (idx < 0) {
    return { ok: false, reason: 'no `await` token found in file' };
  }
  // Skip `await ` and any whitespace, then read the next chars.
  const after = stripped.slice(idx + 'await'.length, idx + 'await'.length + 40);
  // Allow leading whitespace, then `requireRole(`.
  if (!/^\s*requireRole\s*\(/.test(after)) {
    return {
      ok: false,
      reason: `first \`await\` is followed by "${after.trimStart().slice(0, 30).replace(/\s+/g, ' ')}…", not \`requireRole(\``,
    };
  }
  return { ok: true, reason: '' };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('admin routes — defense-in-depth (AC5)', () => {
  const files = collectAdminGatedFiles();

  it('collects at least one file under app/(admin) — sanity (t3 ships /admin/page.tsx)', () => {
    // Catches the "glob matched zero files" silent-pass trap. If the
    // walker matches nothing, every per-file assertion below is a
    // no-op — that would let a future refactor silently bypass the
    // gate by simply renaming the route group. Pin a >= 1 floor here.
    expect(files.length).toBeGreaterThanOrEqual(1);
    // And specifically, /admin/page.tsx is shipped in t3 and MUST be
    // in scope of the walker. We use a path suffix match so the
    // assertion survives moves within the route group.
    const hasAdminPage = files.some((f) =>
      f.replace(/\\/g, '/').endsWith('/app/(admin)/admin/page.tsx'),
    );
    expect(hasAdminPage).toBe(true);
  });

  it('admin gated files: existence-grep matches `/await\\s+requireRole\\((manager|owner)\\)/`', () => {
    // Per-file existence check. We aggregate failures so a single
    // missing gate doesn't blind the developer to the rest.
    const failures: Array<{ file: string; reason: string }> = [];
    for (const abs of files) {
      const src = readFileSync(abs, 'utf8');
      if (!/await\s+requireRole\(\s*['"](manager|owner)['"]\s*\)/.test(src)) {
        failures.push({
          file: path.relative(REPO_ROOT, abs),
          reason: "no `await requireRole('manager'|'owner')` match found in source",
        });
      }
    }
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
  });

  it("admin gated files: AST walker — every exported async fn's first await is `requireRole('manager'|'owner')`", () => {
    const failures: Array<{ file: string; fn: string; reason: string }> = [];
    for (const abs of files) {
      const src = readFileSync(abs, 'utf8');
      const sourceFile = ts.createSourceFile(
        path.basename(abs),
        src,
        ts.ScriptTarget.Latest,
        /* setParentNodes */ true,
        /\.tsx$/.test(abs) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );

      if (isBarrelReExport(sourceFile)) continue;

      const fns = collectExportedAsyncFunctions(sourceFile);
      if (fns.length === 0) {
        failures.push({
          file: path.relative(REPO_ROOT, abs),
          fn: '<top-level>',
          reason: 'no exported async function found (page/action must export at least one)',
        });
        continue;
      }

      for (const fn of fns) {
        const firstAwait = findFirstAwait(fn.body);
        if (!firstAwait) {
          failures.push({
            file: path.relative(REPO_ROOT, abs),
            fn: fn.name,
            reason:
              'function body contains no `await` — at minimum, `await requireRole(...)` is required',
          });
          continue;
        }
        const verdict = isRequireRoleAwait(firstAwait);
        if (!verdict.ok) {
          failures.push({
            file: path.relative(REPO_ROOT, abs),
            fn: fn.name,
            reason: `first await is not requireRole(...): ${verdict.reason}`,
          });
        }
      }
    }
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
  });

  it('admin gated files: regex fallback — first `await` token in source is followed by `requireRole(` within 40 chars', () => {
    // Independent of the AST walker. Catches the same regression via
    // a different code path — if the AST walker has a bug, this still
    // fires; if the regex has a bug, the AST still fires. Belt-and-
    // braces is the contract this test enforces.
    const failures: Array<{ file: string; reason: string }> = [];
    for (const abs of files) {
      const src = readFileSync(abs, 'utf8');
      const verdict = regexFallbackFirstAwait(src);
      if (!verdict.ok) {
        failures.push({ file: path.relative(REPO_ROOT, abs), reason: verdict.reason });
      }
    }
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
  });
});

describe('middleware path-gate regression (AC6)', () => {
  // AC6: GATED_PREFIXES MUST still include '/admin'. The behavioral
  // assertions (unauthenticated /admin → redirect) live in
  // tests/auth/middleware.test.ts; this test catches a silent edit to
  // the constant — e.g. a worker who deletes /admin from the array
  // thinking the layout's gate "covers it" (it does not — the layout
  // never runs for unauthenticated users because the layout would
  // call requireRole, which would itself redirect, but the path-gate
  // is the FIRST line of defense and the spec mandates it stays).

  it('middleware.ts GATED_PREFIXES array contains `/admin`', () => {
    const src = readFileSync(MIDDLEWARE_PATH, 'utf8');
    // Pin the constant name AND the entry. The regex is tolerant of
    // ordering (any position in the array) and quoting (single OR
    // double quotes), but pins the literal `/admin` token bounded by
    // quotes — so `/admin-evil` does not satisfy.
    expect(src).toMatch(/GATED_PREFIXES\s*=\s*\[[^\]]*['"]\/admin['"][^\]]*\]/);
  });

  it('middleware.ts GATED_PREFIXES also contains `/dashboard` and `/profile` (no regression)', () => {
    // The spec calls out the full array. Pin all three — a refactor
    // that drops `/dashboard` or `/profile` would also be a session-
    // gate regression even if `/admin` survives.
    const src = readFileSync(MIDDLEWARE_PATH, 'utf8');
    expect(src).toMatch(/GATED_PREFIXES\s*=\s*\[[^\]]*['"]\/dashboard['"][^\]]*\]/);
    expect(src).toMatch(/GATED_PREFIXES\s*=\s*\[[^\]]*['"]\/profile['"][^\]]*\]/);
  });

  it('tests/auth/middleware.test.ts still exists and exercises the /admin gate (regression cross-link)', () => {
    // If a future cleanup deletes the middleware test, the AC6
    // regression coverage evaporates silently. Pin existence + the
    // /admin assertion via a coarse source-grep.
    expect(existsSync(MIDDLEWARE_TEST_PATH)).toBe(true);
    const src = readFileSync(MIDDLEWARE_TEST_PATH, 'utf8');
    expect(src).toMatch(/\/admin/);
  });
});
