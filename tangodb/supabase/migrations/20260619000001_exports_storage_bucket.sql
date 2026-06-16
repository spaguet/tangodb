-- Temporary CSV exports for mobile/Telegram download (signed URLs).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'exports',
  'exports',
  false,
  5242880,
  array['text/csv', 'text/plain', 'application/csv', 'application/octet-stream']
)
on conflict (id) do nothing;

drop policy if exists "exports_insert_own" on storage.objects;
drop policy if exists "exports_select_own" on storage.objects;
drop policy if exists "exports_delete_own" on storage.objects;

create policy "exports_insert_own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'exports'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "exports_select_own"
on storage.objects for select to authenticated
using (
  bucket_id = 'exports'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "exports_delete_own"
on storage.objects for delete to authenticated
using (
  bucket_id = 'exports'
  and (storage.foldername(name))[1] = auth.uid()::text
);
