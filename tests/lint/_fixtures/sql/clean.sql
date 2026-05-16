-- Clean fixture: `at time zone` is present inside the date_trunc call.
-- ADR-0034 §"Storage and database rules" satisfied: the bucket expresses
-- the zone explicitly, so the lint must NOT fire on this file.
select
  date_trunc('day', created_at at time zone 'America/Chicago') as bucket,
  count(*) as n
from audit_log
group by 1
order by 1 desc;
