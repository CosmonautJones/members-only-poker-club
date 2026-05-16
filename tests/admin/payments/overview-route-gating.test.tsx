/**
 * Source-grep / AST invariants for `app/(admin)/admin/payments/page.tsx`
 * (ADR-0036 AC27).
 *
 * Run locally:    pnpm test tests/admin/payments/overview-route-gating.test.tsx
 * Prerequisites:  none — pure filesystem + TypeScript-AST traversal.
 *
 * Spec: docs/specs/0036-payment-management-console-implementation.md
 *       AC27 (payment-specific discoverability test for the defense-in-
 *       depth contract that `tests/auth/admin-routes-defense-in-depth.test.ts`
 *       already enforces across the entire `app/(admin)/**\/page.tsx` set).
 *       This file's existence is the AC27 contract: a reader pulling on
 *       the payments-console surface finds a focused invariant test
 *       co-located with the other payments tests, rather than having
 *       to chase the cross-cutting walker.
 *
 * SUT contract:
 *   1. The page source imports `requireRole` from
 *      `@/lib/auth/requireRole` (canonical import path — the alias
 *      `@/` resolves to the repo root per tsconfig + vitest config).
 *   2. The page source declares `export const dynamic = 'force-dynamic';`
 *      so the count queries run on every request (no SSG of stale
 *      operational counts).
 *   3. The page source is a Server Component — no `'use client';`
 *      directive.
 *   4. The default-exported async function's FIRST awaited expression
 *      is `await requireRole('manager');` — same first-await contract
 *      the cross-cutting walker enforces, asserted here via the same
 *      AST mechanism for payment-surface discoverability.
 *   5. The page source uses cookie-scoped `createClient()` from
 *      `@/lib/supabase/server` (NOT the service-role admin client).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const PAGE_PATH = path.join(REPO_ROOT, 'app', '(admin)', 'admin', 'payments', 'page.tsx');

describe('admin payments overview — route-gating source contract (AC27)', () => {
  it('the page file exists at the canonical path', () => {
    expect(existsSync(PAGE_PATH)).toBe(true);
  });

  it('imports `requireRole` from `@/lib/auth/requireRole`', () => {
    const src = readFileSync(PAGE_PATH, 'utf8');
    expect(src).toMatch(
      /import\s*\{\s*requireRole\s*\}\s*from\s*['"]@\/lib\/auth\/requireRole['"]/,
    );
  });

  it("declares `export const dynamic = 'force-dynamic';`", () => {
    const src = readFileSync(PAGE_PATH, 'utf8');
    expect(src).toMatch(/export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]\s*;?/);
  });

  it("source does NOT contain `'use client'` (server-component-only)", () => {
    const src = readFileSync(PAGE_PATH, 'utf8');
    expect(src).not.toContain("'use client'");
    expect(src).not.toContain('"use client"');
  });

  it('uses cookie-scoped `createClient()` from `@/lib/supabase/server` (no admin/service-role import)', () => {
    const src = readFileSync(PAGE_PATH, 'utf8');
    expect(src).toMatch(/from\s*['"]@\/lib\/supabase\/server['"]/);
    expect(src).not.toMatch(/from\s*['"]@\/lib\/supabase\/admin['"]/);
  });

  it("default-exported async function's first awaited call is `requireRole('manager')`", () => {
    // AST walker — mirrors the per-file logic in
    // `tests/auth/admin-routes-defense-in-depth.test.ts` so this test
    // is independently runnable when the payments console comes up in
    // code review without having to trust the cross-cutting walker.
    const src = readFileSync(PAGE_PATH, 'utf8');
    const sourceFile = ts.createSourceFile(
      path.basename(PAGE_PATH),
      src,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      ts.ScriptKind.TSX,
    );

    // Find `export default async function Foo() { ... }` OR
    // `export default async () => { ... }`.
    let body: ts.Block | undefined;
    for (const stmt of sourceFile.statements) {
      if (
        ts.isFunctionDeclaration(stmt) &&
        stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) &&
        stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) &&
        stmt.body
      ) {
        body = stmt.body;
        break;
      }
      if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
        const expr = stmt.expression;
        if (
          (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) &&
          expr.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) &&
          expr.body &&
          ts.isBlock(expr.body)
        ) {
          body = expr.body;
          break;
        }
      }
    }
    expect(body, 'no default-exported async function found').toBeTruthy();

    // Find the first AwaitExpression in source order, skipping nested
    // function scopes.
    let firstAwait: ts.AwaitExpression | undefined;
    const visit = (node: ts.Node): void => {
      if (firstAwait) return;
      if (ts.isAwaitExpression(node)) {
        firstAwait = node;
        return;
      }
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node)
      ) {
        return;
      }
      ts.forEachChild(node, visit);
    };
    for (const stmt of body!.statements) {
      visit(stmt);
      if (firstAwait) break;
    }
    expect(firstAwait, 'no `await` in default-exported function body').toBeTruthy();

    const expr = firstAwait!.expression;
    expect(ts.isCallExpression(expr)).toBe(true);
    const call = expr as ts.CallExpression;
    expect(ts.isIdentifier(call.expression)).toBe(true);
    expect((call.expression as ts.Identifier).text).toBe('requireRole');
    const arg0 = call.arguments[0];
    expect(arg0 && (ts.isStringLiteral(arg0) || ts.isNoSubstitutionTemplateLiteral(arg0))).toBe(
      true,
    );
    expect((arg0 as ts.StringLiteral).text).toBe('manager');
  });

  it('regex fallback — first `await` token in file is followed by `requireRole(` within 40 chars', () => {
    // Defense-in-depth on the AST walker itself — a different code path
    // catches the same regression if the AST walker has a bug.
    const src = readFileSync(PAGE_PATH, 'utf8');
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
      .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
    const match = stripped.match(/\bawait\b/);
    expect(match, 'no `await` token in file').toBeTruthy();
    const idx = match!.index ?? -1;
    const after = stripped.slice(idx + 'await'.length, idx + 'await'.length + 40);
    expect(after).toMatch(/^\s*requireRole\s*\(/);
  });
});
