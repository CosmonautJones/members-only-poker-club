-- ADR-0020: feature_flags table
-- safe-window: any
--
-- Forward-only schema for the eventual DB-backed flag read path. Slice 1
-- ships the table without consumers; the lib/flags/ module currently reads
-- from an in-code registry. A follow-up slice will wire the lib to read
-- from this table (and add the /admin/flags write surface).
--
-- RLS posture: this table is admin-only. We do not enable row-level
-- security here because:
--   - Reads happen via the service-role key in `lib/flags/db.ts` (future
--     slice), behind the cached read path.
--   - Writes happen only from `/admin/flags` server actions running with
--     the service-role key.
-- Enabling RLS would require crafting policies that reflect those access
-- paths. We document the posture in the comment instead, and revisit when
-- the admin UI lands.

CREATE TABLE feature_flags (
    key         TEXT PRIMARY KEY,
    enabled     BOOLEAN     NOT NULL DEFAULT false,
    percent     INTEGER     NOT NULL DEFAULT 0,
    allowlist   TEXT[]      NOT NULL DEFAULT '{}'::text[],
    role_gate   TEXT        NULL,
    owner       TEXT        NOT NULL,
    expires_at  TIMESTAMPTZ NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  UUID        NULL,

    CONSTRAINT feature_flags_percent_range CHECK (percent BETWEEN 0 AND 100),
    CONSTRAINT feature_flags_key_format CHECK (key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    CONSTRAINT feature_flags_role_gate_values CHECK (
        role_gate IS NULL OR role_gate IN ('member', 'cashier', 'manager', 'owner')
    )
);

COMMENT ON TABLE feature_flags IS
    'Per ADR-0020. Slice 1: schema only; reads still come from lib/flags/registry.ts.';
COMMENT ON COLUMN feature_flags.key IS
    'Stable kebab-case key. Kill-switches prefixed with kill-.';
COMMENT ON COLUMN feature_flags.percent IS
    '0-100 percent rollout. Deterministic on (profile_id, key). Independent across keys.';
COMMENT ON COLUMN feature_flags.allowlist IS
    'Profile IDs that always evaluate to enabled regardless of percent.';
COMMENT ON COLUMN feature_flags.role_gate IS
    'NULL = no role gate. Otherwise: only roles >= gate rank evaluate enabled.';
COMMENT ON COLUMN feature_flags.expires_at IS
    'Stale-flag review cadence anchor. Flags >90d at 0% or 100% are cleanup candidates.';
