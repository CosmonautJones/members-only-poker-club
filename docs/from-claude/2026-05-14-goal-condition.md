# `/goal` condition — finish the 9 unblocked ADRs

Paste-ready completion condition for Claude Code's `/goal` command (v2.1.139+).
Designed against Travis's 4 ping triggers (api-key, login, money, done) and the
existing `/conductor` skill. State carries across sessions via `.goall/state.json`.

## Pre-flight

- `claude --version` ≥ 2.1.139
- Project trust dialog accepted (required for hooks-based commands)
- Auto-mode on (`/auto-mode` toggle) — together with /goal = unattended grind
- `git status` clean
- `.goall/` is in `.gitignore` (already added)

## Invocation

Type `/goal ` in Claude Code, then paste the block below verbatim.

```
Finish the 9 unblocked ADRs (0018, 0020, 0014, 0028, 0016, 0026, 0023, 0015, 0029) by driving each through /conductor in that order, one at a time, until each has a merged PR on main. Goal is met when ANY of these three end states is true and demonstrated in this turn's output:

(A) FULL SUCCESS — All 9 ADRs are shipped. To demonstrate: run `git log --oneline --first-parent main | head -40` and `pnpm typecheck && pnpm test && pnpm build`; surface their outputs; then write a 9-line checklist with one line per ADR formatted "ADR-NNNN <title>: shipped in <SHA>". The last line of the turn must be: "GOAL-A: 9/9 shipped, CI green".

(B) LEGITIMATE BLOCK — Work cannot continue without Travis acting on one of his 4 sanctioned triggers. Surface a single PING line as the LAST line of the turn, exactly in this form: "PING: <trigger> — <detail>" where <trigger> is one of api-key, login, money, or unresolvable-conflict. Include which ADR was being worked on, what specific action Travis must take, and any URL or file path. Do NOT invent workarounds for missing keys, do NOT modify DNS, do NOT touch dashboards (Squarespace, Vercel, Stripe, Twilio, Supabase).

(C) TURN CAP — 50 evaluator turns have elapsed. Surface a status report with one line per ADR (shipped / in-progress / not-started) and the last line must be: "GOAL-C: turn cap reached, <N>/9 shipped".

WORK PATTERN per turn: read .goall/state.json (create if missing with the queue above and pointer 0); identify the next un-shipped ADR; invoke /conductor <NNNN> and let it drive to merge; after a successful merge run `pnpm typecheck && pnpm test && pnpm build` to confirm green; update state; continue to next ADR within the same turn if budget allows. Process strictly in queue order — never work two ADRs in parallel.

HARD CONSTRAINTS: do not modify or merge ADRs 0009, 0010, 0011, 0012, 0013, or 0025 (blocked on external). Do not edit DNS records, .env files, or anything requiring a third-party dashboard login. Do not use --no-verify, --force, or skip pre-commit hooks. Do not push directly to main — conductor opens PRs and merges through its normal flow. If a conductor run requests human input that isn't one of the 4 triggers, default to safe-no and re-dispatch.
```

## Headless variant (overnight)

```bash
claude -p "/goal $(cat docs/from-claude/2026-05-14-goal-condition.md | sed -n '/^```$/,/^```$/p' | sed '1d;$d')" --auto-mode > goal-run.log 2>&1 &
```

Or just paste interactively and walk away — auto-mode handles tool prompts.

## What to expect on return

- `GOAL-A: 9/9 shipped, CI green` — done, review merged PRs.
- `PING: <trigger> — <detail>` — act on the trigger, re-paste the goal to resume. State.json keeps progress.
- `GOAL-C: turn cap reached, <N>/9 shipped` — extend cap if desired and re-paste.

## Why this shape

Three explicit completion arms with literal last-line sentinels (`GOAL-A:`,
`PING:`, `GOAL-C:`) let the Haiku evaluator make cheap, unambiguous yes/no
decisions instead of inferring intent. Encoding the ping as a valid completion
prevents the "missing API key" infinite-no loop. The hard-constraints clause
keeps the grind off DNS/dashboard work that triggers the login ping.
