-- ADR-0036: Payment Management Console (Slice 1 — Schema substrate B).
-- Spec: docs/specs/0036-payment-management-console-implementation.md AC5, AC9.
-- Acceptance criteria covered by this migration: AC5 (structural + behavioral),
-- AC9 (migrate:check passes — purely additive). Verified by
-- tests/migrations/time-bank-shape.test.ts wallet-recompute sub-cases.
--
-- Scope: additive schema changes only. One new function
-- (public.time_ledger_recompute_wallet) and one new trigger
-- (time_ledger_balance_trigger) on time_ledger. No tables, indexes,
-- policies, or constraints. No data-modifying statements outside trigger
-- function body.
--
-- The trigger maintains the time_wallets.balance_minutes invariant:
-- balance_minutes = SUM(time_ledger.amount_minutes) for the given
-- profile_id. The trigger fires AFTER INSERT FOR EACH ROW in the same
-- transaction as the ledger insert — consistency is enforced by the DB,
-- not by application code. time_wallets.balance_cents is a GENERATED
-- column on time_wallets so it recomputes transparently whenever
-- balance_minutes changes (see 0010_time_wallets.sql).
--
-- The function is SECURITY DEFINER so the recompute can write the wallet
-- row even when the inserting session is RLS-scoped (the wallet
-- INSERT/UPDATE is the system's invariant, not the actor's action). This
-- is the same pattern as the role-change audit trigger in 0002.
--
-- INVARIANT (ADR-0011 + premortem R2): the function body MUST NOT contain
-- the literal strings `UPDATE time_ledger` or `DELETE FROM time_ledger`.
-- time_ledger is append-only; the trigger may only READ from it (to
-- compute the running sum) and WRITE to time_wallets. A future amendment
-- that mutates ledger rows from inside this SECURITY DEFINER function
-- would silently subvert the append-only invariant — the shape test
-- asserts the literal strings are absent.
--
-- No UPDATE/DELETE trigger variant: ledger rows are append-only per
-- ADR-0011. Corrections are NEW rows with negative amount_minutes. The
-- trigger ONLY fires AFTER INSERT.

CREATE OR REPLACE FUNCTION public.time_ledger_recompute_wallet()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Upsert the wallet row with the running sum across the ledger. The
  -- COALESCE handles the genesis case (this is the first row for this
  -- profile; SUM returns NULL, COALESCE replaces with 0 — though in
  -- practice NEW.amount_minutes is part of the SUM because the row
  -- has already been inserted before AFTER INSERT FOR EACH ROW fires).
  --
  -- ON CONFLICT (profile_id) DO UPDATE handles the steady-state case:
  -- the wallet row already exists from a prior ledger insert; we just
  -- refresh balance_minutes, last_activity_at, updated_at.
  --
  -- balance_cents is NOT in the column list — it's a GENERATED column
  -- on time_wallets (see 0010_time_wallets.sql) and Postgres recomputes
  -- it transparently from balance_minutes.
  INSERT INTO time_wallets (profile_id, balance_minutes, last_activity_at, updated_at)
    VALUES (
      NEW.profile_id,
      COALESCE(
        (SELECT SUM(amount_minutes) FROM time_ledger WHERE profile_id = NEW.profile_id),
        0
      ),
      now(),
      now()
    )
  ON CONFLICT (profile_id) DO UPDATE
    SET balance_minutes  = EXCLUDED.balance_minutes,
        last_activity_at = EXCLUDED.last_activity_at,
        updated_at       = EXCLUDED.updated_at;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.time_ledger_recompute_wallet() IS
    'Per ADR-0011 / ADR-0036 AC5. Maintains time_wallets.balance_minutes = '
    'SUM(time_ledger.amount_minutes) for the affected profile_id. Runs '
    'SECURITY DEFINER so the wallet upsert succeeds even when the inserting '
    'session is RLS-scoped. INVARIANT (premortem R2): this function body '
    'MUST NOT mutate time_ledger rows (no UPDATEs, no DELETEs); the ledger '
    'is append-only and this trigger may only READ from it and WRITE to '
    'time_wallets. A future amendment that mutates ledger rows from inside '
    'this SECURITY DEFINER function would silently subvert the append-only '
    'invariant. The shape test asserts the forbidden mutating statements '
    'are absent from the function body.';

CREATE TRIGGER time_ledger_balance_trigger
  AFTER INSERT ON time_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.time_ledger_recompute_wallet();

COMMENT ON TRIGGER time_ledger_balance_trigger ON time_ledger IS
    'Per ADR-0036 AC5. Fires AFTER INSERT FOR EACH ROW; no UPDATE or DELETE '
    'variant because time_ledger is append-only (ADR-0011). The wallet '
    'recompute runs in the same transaction as the ledger insert — '
    'consistency is enforced by the DB.';
