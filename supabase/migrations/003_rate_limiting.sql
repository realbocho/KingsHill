-- ============================================================
-- RATE LIMITING
-- A simple fixed-window counter stored in Postgres so it works
-- correctly across multiple serverless function instances (unlike
-- in-memory counters, which reset per cold start and don't share
-- state across concurrent invocations).
-- ============================================================

create table if not exists rate_limits (
  id          uuid primary key default uuid_generate_v4(),
  bucket_key  text not null,        -- e.g. "bid:telegram_id:123456"
  window_start timestamptz not null,
  count       int not null default 1,
  unique (bucket_key, window_start)
);

create index if not exists rate_limits_lookup on rate_limits(bucket_key, window_start);

-- Cleanup old windows periodically (called by the cron sweep endpoint)
create or replace function cleanup_rate_limits() returns int as $$
declare
  v_count int;
begin
  delete from rate_limits where window_start < now() - interval '1 hour';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$ language plpgsql security definer;

-- Atomically increments the counter for a fixed window and returns
-- the count after incrementing. Caller compares this against a limit.
create or replace function rate_limit_hit(
  p_bucket_key    text,
  p_window_seconds int
) returns int as $$
declare
  v_window_start timestamptz;
  v_count        int;
begin
  -- Round down to the window boundary so all requests in the same
  -- window share one row (fixed-window algorithm — simple and cheap).
  v_window_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into rate_limits (bucket_key, window_start, count)
  values (p_bucket_key, v_window_start, 1)
  on conflict (bucket_key, window_start)
  do update set count = rate_limits.count + 1
  returning count into v_count;

  return v_count;
end;
$$ language plpgsql security definer;

alter table rate_limits enable row level security;
create policy "Service full access rate_limits" on rate_limits for all using (auth.role() = 'service_role');
