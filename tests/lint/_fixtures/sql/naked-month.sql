-- Naked-month fixture. Must produce exactly one finding.
select date_trunc('month', created_at) as bucket, count(*) from audit_log group by 1;
