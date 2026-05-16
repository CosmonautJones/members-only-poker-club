/*
  Block-comment fixture: the forbidden pattern appears inside a block
  comment — `date_trunc('day', x)` with no `at time zone`. The lint must
  strip block comments before scanning, so this file produces 0 findings.
*/
select created_at, count(*) from audit_log group by created_at;
