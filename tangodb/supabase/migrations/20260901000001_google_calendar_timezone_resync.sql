-- Google Calendar: enqueue future resync when organization timezone changes (GCAL Prompt 14)

BEGIN;

CREATE OR REPLACE FUNCTION enqueue_calendar_timezone_resync(p_organization_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT l.source_type, l.source_id, l.occurrence_date
    FROM google_calendar_event_links l
    WHERE l.organization_id = p_organization_id
      AND l.occurrence_date >= CURRENT_DATE
      AND l.sync_status IN ('synced', 'pending', 'failed')
  LOOP
    PERFORM enqueue_calendar_sync(
      p_organization_id,
      r.source_type,
      r.source_id,
      r.occurrence_date,
      'upsert'
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION enqueue_calendar_timezone_resync(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enqueue_calendar_timezone_resync(uuid) TO service_role;

CREATE OR REPLACE FUNCTION organization_settings_timezone_calendar_sync_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.timezone IS DISTINCT FROM NEW.timezone THEN
    PERFORM enqueue_calendar_timezone_resync(NEW.organization_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organization_settings_timezone_calendar_sync_trg ON organization_settings;

CREATE TRIGGER organization_settings_timezone_calendar_sync_trg
  AFTER UPDATE OF timezone ON organization_settings
  FOR EACH ROW
  EXECUTE FUNCTION organization_settings_timezone_calendar_sync_enqueue();

COMMIT;
