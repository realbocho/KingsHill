-- ============================================================
-- IMAGE UPLOAD: STORAGE BUCKET
-- Supabase Storage buckets are typically created via the Dashboard
-- or the Management API rather than plain SQL, but this can also be
-- done here using the storage schema directly, which is supported
-- on standard Supabase projects.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ad-images',
  'ad-images',
  true,                          -- public read (ads need to be visible to all users)
  5242880,                       -- 5MB max
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

-- Storage RLS: anyone can read (public bucket), but only the
-- service role (our API routes) can write. This forces all uploads
-- through our server, where we validate file type/size/rate-limit
-- and run moderation checks before anything goes live.
drop policy if exists "Public read ad images" on storage.objects;
create policy "Public read ad images"
  on storage.objects for select
  using (bucket_id = 'ad-images');

drop policy if exists "Service write ad images" on storage.objects;
create policy "Service write ad images"
  on storage.objects for all
  using (bucket_id = 'ad-images' and auth.role() = 'service_role');
