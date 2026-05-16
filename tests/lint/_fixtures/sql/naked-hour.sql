-- Naked-hour fixture: same shape as naked-day but with the 'hour' bucket.
-- Must produce exactly one finding.
select date_trunc('hour', created_at) as bucket, count(*) from audit_log group by 1;
