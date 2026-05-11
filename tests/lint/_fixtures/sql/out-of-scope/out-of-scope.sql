-- Out-of-scope fixture: this file contains a naked `date_trunc('day', ...)`
-- violation but lives under `out-of-scope/`. With the default scope filter
-- (which excludes `out-of-scope/`), the lint must NOT scan this file. With
-- an explicit `files` override that names this file, the lint must produce
-- exactly one finding — proving the scope filter is load-bearing.
select date_trunc('day', created_at) from audit_log;
