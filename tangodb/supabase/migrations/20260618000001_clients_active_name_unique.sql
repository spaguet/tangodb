-- DB-6: unique active client name (case-insensitive, trimmed)
CREATE UNIQUE INDEX IF NOT EXISTS clients_active_name_unique
  ON clients (lower(trim(last_name)), lower(trim(first_name)))
  WHERE archived_at IS NULL;
