-- Google Calendar free/busy occupancy check (GCAL Prompt 13)

BEGIN;

ALTER TABLE member_google_calendar_bindings
  ADD COLUMN IF NOT EXISTS freebusy_calendar_ids TEXT[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN member_google_calendar_bindings.freebusy_calendar_ids IS
  'Google calendar IDs to query for busy intervals when booking lessons. Empty = free/busy disabled. Must not include the TangoDB sync calendar unless explicitly chosen.';

COMMIT;
