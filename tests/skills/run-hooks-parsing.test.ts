/**
 * Regression test for /run system hook scripts JSON-payload parsing.
 *
 * Run locally:    pnpm test tests/skills/run-hooks-parsing.test.ts
 * Prerequisites:  node (always present in this Node project), bash on PATH.
 *
 * Context (digest 2026-05-21, entry 3):
 *   The hook scripts (hook-bash-fail.sh, hook-user-correction.sh) initially
 *   used jq with a naive grep fallback for JSON payload parsing. On Windows
 *   dev machines without jq, the grep fallback could not handle nested
 *   fields like `tool_input.command` and silently returned empty strings.
 *   Every hook invocation no-op'd; the inbox stayed empty despite real
 *   failures happening.
 *
 *   PR #41 replaced the parser with a node one-liner (guaranteed available
 *   in this Node project). This test pins that contract:
 *
 *   - hook-bash-fail.sh, given a synthetic non-zero-exit gauntlet payload,
 *     MUST produce a fresh `gauntlet-fail` inbox entry.
 *   - hook-user-correction.sh, given a synthetic prompt containing a
 *     correction phrase, MUST produce a fresh `correction` inbox entry.
 *   - Both scripts MUST be silent (no inbox entry, exit 0) on irrelevant
 *     payloads.
 *
 *   If a future refactor swaps the parser back to jq+grep, OR breaks the
 *   pattern matchers, OR changes inbox-write.sh's contract, this test
 *   catches it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, mkdirSync, existsSync, unlinkSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const REPO_ROOT = process.cwd();
const INBOX = resolve(REPO_ROOT, 'learnings/inbox');
const HOOK_BASH_FAIL = resolve(REPO_ROOT, 'scripts/run-tools/hook-bash-fail.sh');
const HOOK_USER_CORRECTION = resolve(REPO_ROOT, 'scripts/run-tools/hook-user-correction.sh');

// Track which inbox files existed before each test so we can detect new ones.
let pretestEntries: Set<string>;

function ensureInbox() {
  if (!existsSync(INBOX)) {
    mkdirSync(INBOX, { recursive: true });
  }
}

function listInboxEntries(): Set<string> {
  ensureInbox();
  return new Set(readdirSync(INBOX).filter((f) => f.endsWith('.md')));
}

function newEntriesSince(before: Set<string>): string[] {
  return [...listInboxEntries()].filter((f) => !before.has(f));
}

// Run a hook script with the given JSON payload on stdin.
// Uses execFileSync (no shell — args are passed safely as an array).
function runHook(scriptPath: string, payload: string): { exitCode: number } {
  try {
    execFileSync('bash', [scriptPath], {
      input: payload,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });
    return { exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { status?: number };
    return { exitCode: err.status ?? 1 };
  }
}

beforeEach(() => {
  pretestEntries = listInboxEntries();
});

afterEach(() => {
  // Clean up any test-created entries so we leave the inbox as we found it.
  for (const f of newEntriesSince(pretestEntries)) {
    try {
      unlinkSync(join(INBOX, f));
    } catch {
      /* best-effort cleanup */
    }
  }
});

describe('/run hooks: JSON payload parsing (regression guard for PR #41)', () => {
  describe('hook-bash-fail.sh', () => {
    it('writes an inbox entry when given a non-zero-exit gauntlet-shaped payload', () => {
      const payload = JSON.stringify({
        tool_input: { command: 'corepack pnpm typecheck --bogus' },
        tool_response: { exit_code: 1, stderr: 'error TS5023: Unknown compiler option' },
      });

      const result = runHook(HOOK_BASH_FAIL, payload);
      const fresh = newEntriesSince(pretestEntries);

      expect(result.exitCode).toBe(0); // hooks must never break the orchestrator
      expect(fresh.length).toBe(1);
      const entry = fresh[0]!;
      expect(entry).toMatch(/gauntlet-fail\.md$/);

      const body = readFileSync(join(INBOX, entry), 'utf8');
      expect(body).toMatch(/kind: gauntlet-fail/);
      expect(body).toMatch(/exit 1/);
      expect(body).toMatch(/corepack pnpm typecheck --bogus/);
      expect(body).toMatch(/error TS5023/);
    });

    it('writes nothing on exit_code 0 (success)', () => {
      const payload = JSON.stringify({
        tool_input: { command: 'corepack pnpm typecheck' },
        tool_response: { exit_code: 0, stdout: 'ok' },
      });

      const result = runHook(HOOK_BASH_FAIL, payload);
      const fresh = newEntriesSince(pretestEntries);

      expect(result.exitCode).toBe(0);
      expect(fresh.length).toBe(0);
    });

    it('writes nothing on non-gauntlet commands (e.g. git status)', () => {
      const payload = JSON.stringify({
        tool_input: { command: 'git status' },
        tool_response: { exit_code: 1, stderr: 'fatal: not a git repository' },
      });

      const result = runHook(HOOK_BASH_FAIL, payload);
      const fresh = newEntriesSince(pretestEntries);

      expect(result.exitCode).toBe(0);
      expect(fresh.length).toBe(0);
    });

    it('handles malformed JSON without crashing or writing', () => {
      const result = runHook(HOOK_BASH_FAIL, 'not-json-at-all{{{');
      const fresh = newEntriesSince(pretestEntries);

      expect(result.exitCode).toBe(0);
      expect(fresh.length).toBe(0);
    });

    it('handles missing tool_response without crashing', () => {
      const payload = JSON.stringify({ tool_input: { command: 'corepack pnpm test' } });

      const result = runHook(HOOK_BASH_FAIL, payload);
      const fresh = newEntriesSince(pretestEntries);

      expect(result.exitCode).toBe(0);
      expect(fresh.length).toBe(0);
    });
  });

  describe('hook-user-correction.sh', () => {
    it('writes an inbox entry when prompt contains a correction phrase', () => {
      const payload = JSON.stringify({ prompt: 'no, stop doing that — wrong approach' });

      const result = runHook(HOOK_USER_CORRECTION, payload);
      const fresh = newEntriesSince(pretestEntries);

      expect(result.exitCode).toBe(0);
      expect(fresh.length).toBe(1);
      const entry = fresh[0]!;
      expect(entry).toMatch(/correction\.md$/);

      const body = readFileSync(join(INBOX, entry), 'utf8');
      expect(body).toMatch(/kind: correction/);
      expect(body).toMatch(/user correction signal/);
    });

    it('writes nothing on benign prompts that lack correction phrases', () => {
      const payload = JSON.stringify({ prompt: 'please ship the next slice' });

      const result = runHook(HOOK_USER_CORRECTION, payload);
      const fresh = newEntriesSince(pretestEntries);

      expect(result.exitCode).toBe(0);
      expect(fresh.length).toBe(0);
    });

    it('does NOT false-positive on "no problem" or "don\'t worry"', () => {
      // These phrases include "no " and "don't " but are not corrections.
      // The matchers use anchored phrases like "don't do that", "stop doing"
      // — they should not fire here.
      for (const prompt of ['no problem, sounds good', "don't worry about it, this is fine"]) {
        const result = runHook(HOOK_USER_CORRECTION, JSON.stringify({ prompt }));
        const fresh = newEntriesSince(pretestEntries);
        expect(result.exitCode).toBe(0);
        expect(fresh.length, `should not match: "${prompt}"`).toBe(0);
      }
    });

    it('extracts the prompt from alternate field names (user_prompt, message)', () => {
      for (const field of ['prompt', 'user_prompt', 'message']) {
        const payload = JSON.stringify({ [field]: 'revert that last change' });

        const result = runHook(HOOK_USER_CORRECTION, payload);
        const fresh = newEntriesSince(pretestEntries);

        expect(result.exitCode).toBe(0);
        expect(fresh.length, `expected match via .${field}`).toBe(1);

        // Clean up between sub-cases so each starts fresh.
        for (const f of fresh) unlinkSync(join(INBOX, f));
      }
    });
  });
});
