-- ADR-0035: Admin Operations Console (Slice 4).
-- Spec: docs/specs/0035-admin-operations-console-implementation.md AC1, AC3.
-- Acceptance criteria covered by this migration: AC1 (structural), AC3
-- (migrate:check passes), verified by
-- tests/migrations/admin-privacy-requests-shape.test.ts.
--
-- Scope: additive schema changes only. Two new ENUM types, one new table
-- (privacy_requests) with RLS + three policies + one index, and one new
-- sequence (member_number_seq) per premortem R6 mitigation. No data-
-- destructive statements. No modifications to existing tables.
--
-- migration-review: blocking-index-approved
-- Justification for blocking-index: privacy_requests is created EMPTY in
-- this same migration. CREATE INDEX on an empty, newly-created table
-- acquires the lock for microseconds and has no production traffic to
-- block (the table did not exist 2 statements earlier). CONCURRENTLY is
-- not an option because Supabase wraps each migration file in a single
-- transaction and CREATE INDEX CONCURRENTLY cannot run inside a tx. The
-- scanner cannot distinguish "new table + immediate index" from "existing
-- hot table + blocking index" so we acknowledge explicitly here.
--
-- Premortem coupling (.conductor/0035/dispatches/0006-premortem-task.md):
--   R6 — `member_number` fallback path race → create member_number_seq at
--        migration time so the AC12 worker's `nextval()` path is the default,
--        sidestepping the MAX+1 race in the fallback.
--   R7 — `privacy_requests.requester_email` PII drift → column-level COMMENT
--        documents the redaction contract for future CSV-export workers.

-- 1. privacy_request_kind_t enum (AC1).
--    Two values only: 'export' for data exports, 'delete' for account
--    deletion. Values are lowercase to mirror the role_t convention in
--    migration 0002.
CREATE TYPE privacy_request_kind_t AS ENUM ('export', 'delete');

-- 2. privacy_request_status_t enum (AC1).
--    Four-state workflow: pending → in_progress → (completed | rejected).
--    The in_progress state covers the async export-URL generation window
--    where status='in_progress' but export_url is still NULL.
CREATE TYPE privacy_request_status_t AS ENUM (
    'pending',
    'in_progress',
    'completed',
    'rejected'
);

-- 3. privacy_requests table (AC1).
--    Verbatim column set from ADR-0035 §Data Model Deltas. The table backs
--    /admin/privacy (manager queue) and /profile/privacy (member submission).
--
--    ON DELETE NO ACTION on profile_id: prevents a deleted profile from
--    cascading away its own request row. The request row is part of the
--    audit-equivalent trail and must survive account deletion per ADR-0023
--    + ADR-0006 retention rules.
--
--    requester_email is captured at submission time so the post-deletion
--    confirmation email still has an address — profiles.email becomes
--    `del:<sha256>` after softDeleteProfile commits and is no longer a
--    deliverable address. See COMMENT ON COLUMN below for the PII contract.
CREATE TABLE privacy_requests (
    id              UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id      UUID                     NOT NULL REFERENCES profiles(id) ON DELETE NO ACTION,
    requester_email TEXT                     NOT NULL,
    kind            privacy_request_kind_t   NOT NULL,
    status          privacy_request_status_t NOT NULL DEFAULT 'pending',
    submitted_at    TIMESTAMPTZ              NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ              NULL,
    resolved_by     UUID                     NULL REFERENCES auth.users(id) ON DELETE NO ACTION,
    reject_reason   TEXT                     NULL,
    export_url      TEXT                     NULL
);

COMMENT ON TABLE privacy_requests IS
    'Per ADR-0035 (Slice 4). Owns the deletion + export request queue surfaced at '
    '/admin/privacy (manager+) and /profile/privacy (self-submission). Rows are '
    'audit-equivalent: ON DELETE NO ACTION on both profile_id and resolved_by ensures '
    'the request trail survives account deletion and staff turnover. The requester_email '
    'column captures the pre-anonymization address so confirmation emails can be sent '
    'after softDeleteProfile (ADR-0023) replaces profiles.email with a del:<hash> token. '
    'No DELETE policy is intentional — privacy_requests rows are never removed; the '
    'service-role escape hatch is the only path to physical deletion and is reserved '
    'for legal-hold incidents.';

-- Premortem R7: column-level redaction contract. Future workers that add
-- CSV export, audit-log mirroring, or PostHog event emission MUST honor this
-- comment — `requester_email` is the single highest-risk PII surface in
-- this table because it persists FOREVER after softDeleteProfile (the
-- profile row is anonymized but the request row keeps the cleartext email).
COMMENT ON COLUMN privacy_requests.requester_email IS
    'PII — captured pre-anonymization for confirmation email delivery only. '
    'MUST NOT be exported, logged, or rendered in audit_log. Reading requires '
    'manager+ context AND user-visible operational justification.';

-- 4. ENABLE + FORCE row-level security (AC1).
--    FORCE ensures the table owner is also subject to RLS — without it, the
--    Supabase service-role connection (which owns most schema-creating
--    sessions) would bypass policies on this table. The service-role still
--    bypasses RLS via the BYPASSRLS attribute on the role itself; FORCE
--    closes the table-owner loophole specifically.
ALTER TABLE privacy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_requests FORCE  ROW LEVEL SECURITY;

-- 5. SELECT policy — self OR manager+ (AC1).
--    Members see only their own requests. Managers and above see the entire
--    queue (the /admin/privacy surface).
CREATE POLICY privacy_requests_select_self_or_manager ON privacy_requests
    FOR SELECT
    USING (profile_id = auth.uid() OR auth.role_at_least('manager'));

-- 6. INSERT policy — self only (AC1).
--    Members submit requests for their own profile only. Managers do NOT
--    insert requests on behalf of members in v1 (no admin-side submission
--    UI). If that becomes a requirement, a separate
--    `privacy_requests_insert_manager` policy is added in a future slice;
--    we do not pre-emptively broaden the INSERT surface.
CREATE POLICY privacy_requests_insert_self ON privacy_requests
    FOR INSERT
    WITH CHECK (profile_id = auth.uid());

-- 7. UPDATE policy — manager+ only (AC1).
--    Only managers and above can transition status (pending → in_progress
--    → completed/rejected) and set resolved_at / resolved_by / reject_reason
--    / export_url. Members CANNOT update their own request after submission
--    in v1 (no member-side "cancel my request" flow); withdrawal is a
--    future-slice concern. The WITH CHECK mirrors the USING clause so a
--    manager cannot demote themselves into invisibility mid-update.
CREATE POLICY privacy_requests_update_manager ON privacy_requests
    FOR UPDATE
    USING (auth.role_at_least('manager'))
    WITH CHECK (auth.role_at_least('manager'));

-- NO DELETE POLICY (AC1 invariant).
-- Privacy requests are audit-equivalent: they document a member's exercise
-- of GDPR/CCPA rights and the staff response. Deletion would erase that
-- record. Service-role retains BYPASSRLS for legal-hold incidents; the
-- absence of any FOR DELETE policy is the structural enforcement.

-- 8. Status + submitted_at composite index (AC1).
--    The /admin/privacy queue page filters by status='pending' and sorts
--    by submitted_at. The composite index covers both the WHERE and the
--    ORDER BY in a single scan.
CREATE INDEX privacy_requests_status_idx
    ON privacy_requests (status, submitted_at);

-- 9. member_number_seq sequence (premortem R6 mitigation).
--    The approveVerification action (AC12, WB.T8) assigns a member_number
--    via nextval('member_number_seq'). Creating the sequence here at
--    migration time makes the nextval path the DEFAULT — Open Q1 is
--    resolved in favor of the sequence, so the COALESCE(MAX, 0)+1 fallback
--    is never hit in production and the concurrent-approval race
--    documented in the premortem cannot occur. START WITH 1000 leaves room
--    for legacy member numbers from the paper ledger to be backfilled in
--    a future migration without colliding with sequence-generated values.
CREATE SEQUENCE IF NOT EXISTS member_number_seq
    START WITH 1000
    INCREMENT BY 1;

COMMENT ON SEQUENCE member_number_seq IS
    'Per ADR-0035 (premortem R6 mitigation). Source of profiles.member_number '
    'values assigned by approveVerification (ADR-0009). Starts at 1000 to leave '
    'headroom for paper-ledger backfill. nextval() is the only legitimate caller; '
    'manual setval is reserved for migration-only operations.';
