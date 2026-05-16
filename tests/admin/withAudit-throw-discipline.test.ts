/**
 * Cross-cutting source-grep guard: every admin server action MUST throw
 * `Error` subclasses (NOT string literals) so `withAudit` can capture
 * the stack and propagate the typed name (ADR-0035 premortem R12, WD.T23
 * / t21).
 *
 * Run locally:    pnpm test tests/admin/withAudit-throw-discipline.test.ts
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md +
 *       docs/from-claude/2026-05-14-goal-condition.md (premortem R12).
 *
 * Contract (two assertions):
 *
 *   (1) Zero `throw '<string-literal>'` occurrences in any admin action
 *       file. A string-literal throw evades `withAudit`'s `error instanceof
 *       Error` narrowing, leaks the audit-tx commit window with no
 *       forensic breadcrumb, AND surfaces in the page-level error
 *       boundary as a generic "Object" -- none of these is recoverable.
 *
 *   (2) Every exported error class in `app/(admin)/admin/_errors.ts`
 *       declares `extends Error`. This is the structural mirror of
 *       (1): the typed errors thrown by the actions all extend Error,
 *       so the discipline test holds for both the throw site AND the
 *       class definition.
 *
 * Why source-grep: the runtime path through `withAudit` already swallows
 * non-Error throws (it narrows via `error instanceof Error`), so a
 * string-literal throw at runtime would silently elide the audit
 * breadcrumb AND surface a confusing toast. The cross-cutting walker
 * catches the violation at CI time.
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

function relpath(abs: string): string {
  const norm = abs.replace(/\\/g, '/');
  const adminIdx = norm.indexOf('/admin/');
  if (adminIdx < 0) return norm;
  return norm.slice(adminIdx + '/admin/'.length);
}

/**
 * Strip block + line comments so a `// throw 'this is okay'` line is
 * not flagged. Returns code with comments replaced by single spaces so
 * line numbers stay stable for any future column-aware diagnostics.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (s) => ' '.repeat(s.length))
    .replace(/\/\/[^\n]*/g, (s) => ' '.repeat(s.length));
}

describe('withAudit throw discipline / source-grep', () => {
  const actionFiles = collectActionFiles(ADMIN_ROOT);

  it('discovers at least one action file (sanity)', () => {
    expect(actionFiles.length).toBeGreaterThan(0);
  });

  it('no action file throws a string literal', () => {
    // `throw 'foo'` OR `throw "foo"` -- captures both quote styles.
    // The walker DOES allow `throw new <Class>(...)` because `new`
    // separates the throw token from the string literal.
    const STRING_THROW_RE = /\bthrow\s+(?:'[^'\n]*'|"[^"\n]*")/;
    const offenders: { file: string; match: string }[] = [];
    for (const abs of actionFiles) {
      const source = stripComments(readFileSync(abs, 'utf-8'));
      const m = STRING_THROW_RE.exec(source);
      if (m) {
        offenders.push({ file: relpath(abs), match: m[0] });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every exported error class in _errors.ts extends Error', () => {
    const errorsPath = resolve(ADMIN_ROOT, '_errors.ts');
    const source = stripComments(readFileSync(errorsPath, 'utf-8'));

    // Match `export class X extends Y { ... }` -- capture every export
    // class declaration's superclass identifier.
    const classRe = /\bexport\s+class\s+(\w+)\s+extends\s+(\w+)/g;
    const declarations: { name: string; extendsClause: string }[] = [];
    let match: RegExpExecArray | null;
    while ((match = classRe.exec(source)) !== null) {
      declarations.push({ name: match[1]!, extendsClause: match[2]! });
    }

    expect(declarations.length).toBeGreaterThan(0);
    const offenders = declarations.filter((d) => d.extendsClause !== 'Error');
    expect(offenders).toEqual([]);
  });

  it('every exported _errors.ts class sets this.name in its constructor', () => {
    // Secondary defense -- even when a class extends Error, withAudit's
    // forensic posture depends on the `error.name` carrying the typed
    // class name (the analytics helper's classifier reads `error.name`
    // to map to the `denied` outcome). Assert every export class
    // assigns `this.name = '<ClassName>'`.
    const errorsPath = resolve(ADMIN_ROOT, '_errors.ts');
    const source = stripComments(readFileSync(errorsPath, 'utf-8'));

    const classRe = /\bexport\s+class\s+(\w+)\s+extends\s+Error\s*\{([\s\S]*?)\n\}/g;
    const offenders: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = classRe.exec(source)) !== null) {
      const name = match[1]!;
      const body = match[2]!;
      // Look for `this.name = '<name>'` OR `this.name = "<name>"`
      const nameRe = new RegExp(`this\\.name\\s*=\\s*['"]${name}['"]`);
      if (!nameRe.test(body)) {
        offenders.push(name);
      }
    }
    expect(offenders).toEqual([]);
  });
});
