-- ============================================================
-- REALTIME
-- Adds the tables the client needs to subscribe to into Supabase's
-- realtime publication, so changes stream to connected clients via
-- websocket instead of requiring polling.
-- ============================================================

alter publication supabase_realtime add table occupancies;
alter publication supabase_realtime add table ad_slots;
alter publication supabase_realtime add table bid_history;

-- Full row data on UPDATE/DELETE (not just the primary key) so the
-- client can react to exactly what changed without an extra fetch.
alter table occupancies replica identity full;
alter table ad_slots    replica identity full;
alter table bid_history replica identity full;
