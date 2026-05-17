# Conductor skill sync flow (in-project ↔ conductor-harness)

**Audience:** Travis + future-me (Claude) editing the `/conductor` skill.
**Last updated:** 2026-05-17 (during v0.4 → v0.5 patch).

## TL;DR

Two copies of the conductor skill exist on this machine:

| Location                                                                                   | Role                            | Authoritative? |
| ------------------------------------------------------------------------------------------ | ------------------------------- | -------------- |
| `members-only-poker-club/.claude/skills/conductor/`                                        | **Live** — runs when `/conductor` is invoked here | ✅ Yes         |
| `C:\Users\Travis\Downloads\conductor-harness\.claude\skills\conductor\`                    | Staging — source for other projects + future installs | Mirrored from live |

Edit direction is **live → staging**. The in-project copy is where iteration happens (because that's where it runs, where its tests run, and where retrospectives produce evidence). After a v0.X bump validates in-project, the same patches are mirrored to staging so the next project that installs the skill gets the improved version.

## Why this asymmetry

The conductor was initially installed FROM `Downloads/conductor-harness/` INTO the project's `.claude/`. After that initial install, every meaningful evolution has happened against the live copy:

- v0.3 pre-ratification debate (triage, falsifier, direction-premortem)
- v0.4 critic proposal mode (mechanically verify falsifier coverage)
- v0.5 goal integration + turn-boundary discipline + learning loop

The Downloads copy froze at the install-time snapshot. As of 2026-05-17 it is **1 day older** than the live copy (per file mtime check). Treating Downloads as the source-of-truth would mean losing every in-project evolution; treating live as the source-of-truth lets the skill grow against real evidence.

## Sync mechanism (manual for now)

After patching the live skill:

1. Diff the live tree against the Downloads tree to see what changed:

   ```sh
   diff -ruN \
     "$DOWNLOADS/conductor-harness/.claude/skills/conductor" \
     ".claude/skills/conductor" \
     | head -200
   ```

2. Copy each changed file from live → Downloads. Preserve directory structure (`templates/`, `SKILL.md`, etc.).

3. Verify with `pnpm tsx scripts/conductor/validate-skill.ts` against BOTH copies — the validator's path arg defaults to in-project; pass the Downloads path to check the staging copy too.

4. Commit in conductor-harness if it's a separate repo (recommended); otherwise commit the live changes here and note the Downloads sync in the commit message.

A future improvement: a `scripts/sync-conductor-upstream.sh` (or `.ps1`) that does the diff-then-copy in one shot with `--dry-run` and `--apply` flags. Out of scope for v0.5; tracked here.

## When to sync

- **Always after a SKILL.md version bump.** v0.4 → v0.5 is mandatory.
- **Always after a template field becomes REQUIRED (new schema obligation).** Workers reading the staging copy will surface different errors than workers reading the live copy.
- **Optional for KB/doc-only changes.** The Downloads copy doesn't carry project KB; if a change is only in `docs/kb/conductor-loop.md`, no sync needed.

## When NOT to sync

- Project-specific KB additions (`docs/kb/*` in this project) — those stay in-project.
- Project-specific journal entries — same.
- Anything under `.conductor/<N>/` — those are run-evidence, not skill state. Each project produces its own.

## Future: the `/conductor learn` sub-command will help

v0.5 ships `/conductor learn` which applies user-approved `skill-diff-proposal.md` patches to **both** copies in one operation. Once that flow proves out, the sync is no longer a "manual diff and copy" step — it's a side-effect of applying a learning proposal. The sync flow document remains useful as a fallback for direct SKILL.md edits that don't come from a retrospective.

## Related

- `docs/kb/conductor-goal-integration.md` — the new sentinel contract that v0.5 introduces.
- `.claude/skills/conductor/SKILL.md` §Self-improvement loops — the seam `/conductor learn` closes.
