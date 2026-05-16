-- Sibling-statement fixture: the first statement has a naked `date_trunc`;
-- the second statement happens to contain `at time zone`. They are
-- separated by `;` and are NOT in the same expression. The lint must
-- produce exactly one finding (on the first statement).
select date_trunc('day', created_at) from audit_log;
select created_at at time zone 'UTC' from audit_log;
