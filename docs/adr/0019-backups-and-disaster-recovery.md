# ADR-0019: Backups & disaster recovery

- **Status:** Accepted
- **Date:** 2026-05-04
- **Ratified:** 2026-05-08
- **Slice:** 4

## Context

The database is the only thing we can't recreate from source code. If it dies — corruption, accidental drop, vendor outage — we need a recent backup and a tested restore path.

## Decision

### Backups

- Supabase Pro tier daily backups (7-day retention by default; bump to 30-day on the production project).
- Point-in-Time Recovery (PITR) enabled on production (Supabase Pro+ feature).
- Stripe data is the source of truth for subscription/payment events; we can replay webhooks if our `payments` table is corrupted (Stripe retains 90 days of events).
- ID document images backed up via Supabase Storage's built-in S3 backups (Pro tier).

### Recovery objectives

- **RPO** (max acceptable data loss): 1 hour (PITR window).
- **RTO** (max acceptable downtime to restore): 4 hours.

### Drill cadence

- **Quarterly DR drill.** Restore latest backup into staging, run smoke tests, document any deviations from runbook.
- First drill: end of Slice 4.
- Owner participates in every drill — must know how to initiate restore even if developer is unavailable.

### Runbook

`docs/runbooks/runbook-restore-from-backup.md` (Slice 4) covers:

- How to initiate Supabase PITR
- How to validate restored data
- How to re-point Vercel envs at restored DB
- How to backfill any missed Stripe events from the period of data loss
- How to communicate to members (status page, email)

### Status page

`status.<domain>` on Vercel, polling `/api/health`. Manual override for owner during incidents.

## Open questions (deferred)

- **Cross-region replication** — deferred to Slice 4. Probably not needed at our scale (Supabase Pro is single-region; cost/complexity exceeds the recovery-time benefit at <10K members).
- **Off-site secondary backup** — deferred. Supabase Pro PITR + Stripe replay covers our RPO/RTO. Re-evaluate if we ever store data Stripe doesn't replicate (e.g., handwritten incident notes).
- **Encryption-at-rest verification on backup files** — deferred to Slice 4 DR drill; verify Supabase's documented at-rest encryption applies to backup snapshots and document the verification step in `docs/runbooks/runbook-restore-from-backup.md`.
