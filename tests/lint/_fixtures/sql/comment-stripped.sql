-- DO NOT use date_trunc('day', x) without `at time zone` — the previous
-- line mentions the forbidden pattern inside a line-comment; the lint must
-- strip comments BEFORE scanning, so this file produces 0 findings.
select
  created_at,
  count(*)
from audit_log
group by created_at;
