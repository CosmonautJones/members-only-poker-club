# Contributing

This is an internal project. External pull requests will be closed.

## Workflow

1. Read [`docs/spec.md`](docs/spec.md) and the relevant ADRs in [`docs/adr/`](docs/adr/) before changing anything.
2. Branch from `main`. Branch names should be `slice-N/short-description` for slice work, `fix/...` for bugs, `chore/...` for maintenance.
3. Open a PR. CI must pass (typecheck, lint, unit tests, e2e).
4. PR titles follow [Conventional Commits](https://www.conventionalcommits.org/): `feat(scope): ...`, `fix(scope): ...`, `chore(scope): ...`, `docs(scope): ...`.
5. Squash-merge to `main`. Deploys are automatic via Vercel.

## TDD policy

- **Required for `lib/`** — any code that touches money, identity, RLS-relevant logic, idempotency, or webhooks must have a failing test written before the implementation lands. See [ADR-021](docs/adr/0021-testing-strategy.md).
- **Not required for visual components** — write tests after, focused on contract (props in → DOM out) not pixel-perfect rendering.
- **End-to-end tests** are mandatory for every user-facing flow that crosses an auth boundary or calls Stripe.

## Domain language

Use the ubiquitous language defined in [`docs/spec.md`](docs/spec.md):

- **Member** — an authenticated user who has signed the member agreement.
- **Membership** — a Stripe Subscription tied to a member, with a `billing_kind` of `autopay` ($25/mo) or `invoice` ($30/mo).
- **Time bank** — the prepaid stored-value wallet attached to each member.
- **Time ledger** — append-only log of every wallet credit/debit. The wallet balance is a projection.
- **Cashier** — a staff role with permission to redeem time and look up members.
- **Manager** — staff role above cashier; can issue refunds and override membership state.
- **Owner** — top-level admin role.

Don't introduce new terms without proposing them in an ADR or the spec.

## ADRs

Write a new ADR when you make a decision that:

- Is hard to reverse later
- Affects more than one module
- Trades off security, performance, cost, or correctness in a way that a future developer could reasonably second-guess

ADRs are short (≤1 page): Context → Decision → Consequences → Alternatives. See [`docs/adr/README.md`](docs/adr/README.md).

## Setup

- Node 20+, pnpm via corepack: `corepack enable`
- Install: `corepack pnpm install`
- Run dev: `corepack pnpm dev`
- Run tests: `corepack pnpm test`

## Signed commits

This repo requires signed commits on `main`. Set up commit signing once:

```bash
# GPG (recommended)
gpg --full-generate-key
git config --global user.signingkey <KEY-ID>
git config --global commit.gpgsign true

# OR SSH (Git 2.34+)
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

See https://docs.github.com/en/authentication/managing-commit-signature-verification for full setup including uploading the public key to your GitHub account.

## Pre-commit hooks (Husky — optional local convenience)

Husky is **optional**. The CI gauntlet (`.github/workflows/ci.yml`) is the load-bearing merge gate; Husky is a fast local convenience that runs typecheck + lint pre-push to catch errors before they round-trip through CI. Skipping Husky never produces a different merge outcome — it only changes how quickly you find out you broke something.

Setup:
```bash
corepack pnpm exec husky install
echo "corepack pnpm typecheck && corepack pnpm lint" > .husky/pre-push
chmod +x .husky/pre-push
```

## CI

The full CI gauntlet runs on every PR (`.github/workflows/ci.yml`). Required checks: install, typecheck, lint, test, e2e, lighthouse, backstop-greps. See [docs/ops/branch-protection.md](docs/ops/branch-protection.md) for the exact required-check names that gate merges, and [docs/ops/ci-secrets.md](docs/ops/ci-secrets.md) for the Actions secrets the workflow consumes.

## ADRs and journal

This project uses Architecture Decision Records ([`docs/adr/`](docs/adr/)) and a per-shift journal ([`docs/journal/`](docs/journal/)). Read [`docs/adr/README.md`](docs/adr/README.md) for ADR conventions before adding either. Journal entries are required for emergency-hotfix bypasses of branch protection (see [docs/ops/branch-protection.md](docs/ops/branch-protection.md)) and recommended at the end of any work session that produced a non-trivial decision.
