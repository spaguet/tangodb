-- Schedule PNG export for Telegram Mini App downloadFile (same-origin proxy).
UPDATE storage.buckets
SET
  allowed_mime_types = ARRAY['text/csv', 'text/plain', 'application/csv', 'image/png'],
  file_size_limit = 10485760
WHERE id = 'exports';
