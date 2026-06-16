-- SD-1: soft delete (archive) for clients
ALTER TABLE clients ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_clients_active_last_name
  ON clients (last_name)
  WHERE archived_at IS NULL;

COMMENT ON COLUMN clients.archived_at IS 'NULL = active; set = archived (soft delete)';

DROP TRIGGER IF EXISTS audit_clients ON clients;
CREATE TRIGGER audit_clients
  AFTER INSERT OR UPDATE OR DELETE ON clients
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
