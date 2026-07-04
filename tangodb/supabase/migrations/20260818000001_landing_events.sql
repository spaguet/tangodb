-- Landing page analytics events (written only via landing-track-event Edge Function).

CREATE TABLE landing_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  event         TEXT NOT NULL CHECK (
    event IN (
      'pageview',
      'cta_register',
      'cta_demo',
      'cta_telegram',
      'cta_login',
      'scroll_pricing',
      'scroll_faq'
    )
  ),
  visitor_id    TEXT NOT NULL,
  session_id    TEXT,
  path          TEXT NOT NULL,
  locale        TEXT,
  referrer      TEXT,
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT
);

CREATE INDEX idx_landing_events_created_at
  ON landing_events (created_at DESC);

CREATE INDEX idx_landing_events_event
  ON landing_events (event);

CREATE INDEX idx_landing_events_event_created_at
  ON landing_events (event, created_at DESC);

CREATE INDEX idx_landing_events_visitor_id
  ON landing_events (visitor_id);

COMMENT ON TABLE landing_events IS
  'Anonymous landing analytics. No IP or PII. Inserts via service_role in landing-track-event only.';

ALTER TABLE landing_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON landing_events TO service_role;
