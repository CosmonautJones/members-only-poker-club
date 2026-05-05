# Architecture Decision Records

Each ADR captures one decision: **Context → Decision → Consequences → Alternatives**. ≤1 page each.

## Conventions

- Filenames: `NNNN-kebab-title.md`, four-digit zero-padded.
- Numbers are immutable. If an ADR is superseded, write a new one and mark the old one `Status: Superseded by ADR-NNNN`.
- Every PR that introduces a new architectural decision includes an ADR.
- Every ADR includes the **Slice** it ships in.

## Status legend

- **Stub** — placeholder; the decision will be made in its slice
- **Proposed** — drafted, awaiting review
- **Accepted** — current decision
- **Deprecated** — no longer the recommended path
- **Superseded** — replaced by a newer ADR

## Index

### Foundation (written before code)

| # | Title | Status | Slice |
|---|---|---|---|
| [001](0001-tech-stack-and-deployment.md) | Tech stack & deployment | Accepted | 1 |
| [002](0002-authentication-and-session-management.md) | Authentication & session management | Accepted | 1 (skeleton), 2 (full) |
| [003](0003-authorization-model-roles-and-rls.md) | Authorization model — roles + RLS | Accepted | 1 (skeleton), 2 (full) |
| [004](0004-money-handling-integer-cents.md) | Money handling — integer cents, currency | Accepted | 1 |
| [005](0005-idempotency-exactly-once-semantics.md) | Idempotency & exactly-once semantics | Accepted | 2 |
| [006](0006-audit-log-append-only.md) | Audit log — append-only, who-did-what | Accepted | 1 |
| [007](0007-secrets-management.md) | Secrets management | Accepted | 1 |
| [008](0008-environments.md) | Environments | Accepted | 1 |

### Domain

| # | Title | Status | Slice |
|---|---|---|---|
| [009](0009-member-identity-and-id-verification.md) | Member identity & ID verification | Stub | 2 |
| [010](0010-membership-subscription-model.md) | Membership subscription model | Stub | 2 |
| [011](0011-time-bank-model.md) | Time-bank model | Stub | 3 |
| [012](0012-tournament-model.md) | Tournament model | Stub | 1 (read), 3 (write) |
| [013](0013-pokeratlas-integration.md) | PokerAtlas integration | Stub | 5 |

### Reliability & Ops

| # | Title | Status | Slice |
|---|---|---|---|
| [014](0014-observability.md) | Observability | Stub | 1 (skeleton), 4 (full) |
| [015](0015-alerting-and-incident-response.md) | Alerting & incident response | Stub | 4 |
| [016](0016-rate-limiting-and-abuse.md) | Rate limiting & abuse | Stub | 1 (basic), 4 (full) |
| [017](0017-ci-cd.md) | CI/CD | Stub | 1 |
| [018](0018-database-migrations.md) | Database migrations | Stub | 1 |
| [019](0019-backups-and-disaster-recovery.md) | Backups & disaster recovery | Stub | 4 |
| [020](0020-feature-flags.md) | Feature flags | Stub | 4 |
| [021](0021-testing-strategy.md) | Testing strategy | Stub | 1 (skeleton), 4 (formalized) |

### Compliance & customer

| # | Title | Status | Slice |
|---|---|---|---|
| [022](0022-pci-scope.md) | PCI scope | Stub | 2 |
| [023](0023-privacy-gdpr-ccpa-data-deletion.md) | Privacy, GDPR/CCPA, data deletion | Stub | 4 |
| [024](0024-cookie-and-consent-banner.md) | Cookie & consent banner | Stub | 1 |
| [025](0025-email-and-sms-communications.md) | Email/SMS communications | Stub | 2 (email), 3 (SMS) |
| [026](0026-accessibility.md) | Accessibility | Stub | 1 (basic), 4 (audit) |
| [027](0027-support-operations.md) | Support operations | Stub | 4 |

### Growth

| # | Title | Status | Slice |
|---|---|---|---|
| [028](0028-analytics-and-conversion-tracking.md) | Analytics & conversion tracking | Stub | 1 |
| [029](0029-ab-testing-and-experimentation.md) | A/B testing & experimentation | Stub | 4 |
| [030](0030-seo-and-content-strategy.md) | SEO & content strategy | Stub | 1 |

### Strategy

| # | Title | Status | Slice |
|---|---|---|---|
| [031](0031-vendor-lock-in-posture.md) | Vendor lock-in posture | Stub | 4 |
| [032](0032-cost-model-and-scaling-thresholds.md) | Cost model & scaling thresholds | Stub | 4 |
