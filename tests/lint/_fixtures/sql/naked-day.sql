-- Naked-day fixture: `date_trunc('day', ...)` with no `at time zone`.
-- ADR-0034 §"Storage and database rules" violated: must produce exactly
-- one finding pointing at the date_trunc line below.
select
  date_trunc('day', created_at) as bucket,
  count(*) as n
from audit_log
group by 1;
