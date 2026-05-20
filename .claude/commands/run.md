---
description: Drive an ADR slice end-to-end via the lightweight /run orchestrator (replaces /conductor for ~90% of slices).
argument-hint: "<adr-number> | <free-form goal>"
---

Invoke the `run` skill with the user's argument.

Argument forms:
- `/run <NNNN>` — drive ADR-NNNN's paired spec through the 7-step ritual (orient → branch hygiene → plan → build → gauntlet → ship → journal)
- `/run <free-form goal>` — ad-hoc slice (skip ADR/spec reads, use the same ritual from step 2 onward)

The `/run` skill is the default for most slices. Use `/conductor` only when the slice has genuine multi-wave parallelism AND high-risk surface simultaneously.

Every turn the orchestrator runs MUST terminate with one of three sentinels (`GOAL-A:`, `PING:`, `GOAL-C:`) per §Sentinel contract in the skill.

User's argument(s): $ARGUMENTS
