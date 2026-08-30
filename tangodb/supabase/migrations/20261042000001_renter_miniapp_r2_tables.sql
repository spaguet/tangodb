-- R2 / 2.9.5: QR Storage, Telegram channel, topup inbox, dialog persist.
-- No GRANT SELECT authenticated. Access via SECURITY DEFINER RPC (next migration).

BEGIN;

-- =============================================================================
-- 1. organization_renter_channel (1:1 org). No mini_app_url column.
-- =============================================================================

CREATE TABLE IF NOT EXISTS organization_renter_channel (
  organization_id      uuid PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  telegram_chat_url    text,
  encrypted_bot_token  bytea,
  telegram_bot_id      bigint,
  bot_username         text,
  bot_token_last4      text,
  app_short_name       text,
  webhook_token        text,
  webhook_secret       text,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (telegram_bot_id IS NULL OR telegram_bot_id > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS organization_renter_channel_bot_id_unique
  ON organization_renter_channel (telegram_bot_id)
  WHERE telegram_bot_id IS NOT NULL;

COMMENT ON TABLE organization_renter_channel IS
  'Mini App bot + studio chat URL. Mini App href is assembled from getMe username + app_short_name, never a stored mini_app_url.';

ALTER TABLE organization_renter_channel ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE organization_renter_channel FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE organization_renter_channel TO service_role;

-- =============================================================================
-- 2. renter_telegram_dialog — Start/write persist before renters INSERT
-- =============================================================================

CREATE TABLE IF NOT EXISTS renter_telegram_dialog (
  organization_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  telegram_id         bigint NOT NULL CHECK (telegram_id > 0),
  bot_started_at      timestamptz,
  allows_write_to_pm  boolean NOT NULL DEFAULT false,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, telegram_id)
);

COMMENT ON TABLE renter_telegram_dialog IS
  'Persist Start / allows_write_to_pm on (org, telegram_id). Webhook and mint write here; Start can precede renters INSERT.';

ALTER TABLE renter_telegram_dialog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE renter_telegram_dialog FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE renter_telegram_dialog TO service_role;

CREATE TABLE IF NOT EXISTS renter_telegram_webhook_updates (
  telegram_bot_id  bigint NOT NULL,
  update_id        bigint NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (telegram_bot_id, update_id)
);

ALTER TABLE renter_telegram_webhook_updates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE renter_telegram_webhook_updates FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE renter_telegram_webhook_updates TO service_role;

-- =============================================================================
-- 3. QR assets + Storage bucket org-rental-qr
-- =============================================================================

CREATE TABLE IF NOT EXISTS organization_rental_qr_assets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  storage_path     text NOT NULL,
  mime_type        text NOT NULL
    CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  file_size        integer NOT NULL CHECK (file_size > 0 AND file_size <= 2097152),
  width            integer CHECK (width IS NULL OR (width > 0 AND width <= 2048)),
  height           integer CHECK (height IS NULL OR (height > 0 AND height <= 2048)),
  label            text,
  is_active        boolean NOT NULL DEFAULT false,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, created_by)
    REFERENCES organization_members (organization_id, id)
);

CREATE INDEX IF NOT EXISTS idx_org_rental_qr_assets_org_active
  ON organization_rental_qr_assets (organization_id)
  WHERE is_active;

COMMENT ON TABLE organization_rental_qr_assets IS
  'Studio QR library for Mini App top-ups. Public read = short-lived signed URL via RPC, not Storage JWT.';

ALTER TABLE organization_rental_qr_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE organization_rental_qr_assets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE organization_rental_qr_assets TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'org-rental-qr',
  'org-rental-qr',
  false,
  2097152,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS org_rental_qr_storage_insert ON storage.objects;
DROP POLICY IF EXISTS org_rental_qr_storage_select ON storage.objects;
DROP POLICY IF EXISTS org_rental_qr_storage_update ON storage.objects;
DROP POLICY IF EXISTS org_rental_qr_storage_delete ON storage.objects;

-- No SELECT for authenticated (renter JWT and staff list via signed URL RPC).
-- No INSERT for authenticated (magic-bytes run in Edge with service_role).

-- =============================================================================
-- 4. renter_topup_requests
-- =============================================================================

CREATE TABLE IF NOT EXISTS renter_topup_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  renter_id        uuid NOT NULL,
  amount           numeric(12, 2) NOT NULL
    CHECK (amount > 0 AND amount <= 1000000),
  method           text NOT NULL CHECK (method IN ('qr', 'cash')),
  qr_asset_id      uuid,
  status           text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'rejected')),
  amount_fact      numeric(12, 2)
    CHECK (amount_fact IS NULL OR (amount_fact > 0 AND amount_fact <= 1000000)),
  resolved_by      uuid,
  resolved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, renter_id)
    REFERENCES renters (organization_id, id),
  FOREIGN KEY (organization_id, qr_asset_id)
    REFERENCES organization_rental_qr_assets (organization_id, id),
  FOREIGN KEY (organization_id, resolved_by)
    REFERENCES organization_members (organization_id, id),
  CHECK (method = 'cash' OR qr_asset_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS renter_topup_requests_one_pending
  ON renter_topup_requests (organization_id, renter_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_renter_topup_requests_org_status
  ON renter_topup_requests (organization_id, status, created_at DESC);

COMMENT ON TABLE renter_topup_requests IS
  'Mini App wallet top-up inbox. Separate from list_rental_payment_inbox. One pending per renter.';

ALTER TABLE renter_topup_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE renter_topup_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE renter_topup_requests TO service_role;

DROP TRIGGER IF EXISTS audit_renter_topup_requests ON renter_topup_requests;
CREATE TRIGGER audit_renter_topup_requests
  AFTER INSERT OR UPDATE OR DELETE ON renter_topup_requests
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- =============================================================================
-- 5. Ledger: unique topup_request_id (belt; UPDATE pending is the primary guard)
-- =============================================================================

ALTER TABLE renter_wallet_ledger
  ADD COLUMN IF NOT EXISTS topup_request_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'renter_wallet_ledger_topup_request_fk'
  ) THEN
    ALTER TABLE renter_wallet_ledger
      ADD CONSTRAINT renter_wallet_ledger_topup_request_fk
      FOREIGN KEY (organization_id, topup_request_id)
      REFERENCES renter_topup_requests (organization_id, id);
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS renter_wallet_ledger_topup_request_unique
  ON renter_wallet_ledger (topup_request_id)
  WHERE entry_type = 'topup' AND topup_request_id IS NOT NULL;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'organization_renter_channel',
    'renter_telegram_dialog',
    'renter_telegram_webhook_updates',
    'organization_rental_qr_assets',
    'renter_topup_requests'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', v_table);
    END IF;
  END LOOP;
END;
$$;

COMMIT;
