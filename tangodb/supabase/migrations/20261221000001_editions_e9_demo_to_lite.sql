-- E9 / 2.12.12: expired demo → licensed Lite (trial_end); flag off keeps 2.11 purge.

BEGIN;

CREATE OR REPLACE FUNCTION convert_expired_demo_to_lite(p_org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_now timestamptz := now();
  v_org organizations%ROWTYPE;
  v_from text;
  v_to text;
  v_ceiling_before text;
  v_ceiling_after text;
  v_from_rank int;
  v_ceiling_rank int;
BEGIN
  SELECT * INTO v_org
  FROM organizations o
  WHERE o.id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_org.status NOT IN ('demo_active', 'demo_retention') THEN
    RETURN false;
  END IF;

  IF v_org.data_purge_at IS NULL OR v_org.data_purge_at > v_now THEN
    RETURN false;
  END IF;

  IF organization_has_lifetime_license(p_org_id) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM organization_subscriptions os
    WHERE os.organization_id = p_org_id
      AND os.status IN ('active', 'past_due')
  ) THEN
    RETURN false;
  END IF;

  IF v_org.purchase_review_hold_until IS NOT NULL
     AND v_now < v_org.purchase_review_hold_until
     AND _organization_has_eligible_purchase_review_new(p_org_id) THEN
    RETURN false;
  END IF;

  v_ceiling_before := organization_effective_ceiling(p_org_id);

  SELECT s.active_edition INTO v_from
  FROM organization_edition_state s
  WHERE s.organization_id = p_org_id
  FOR UPDATE;

  PERFORM _edition_cancel_trial_pro(p_org_id);

  v_ceiling_after := organization_effective_ceiling(p_org_id);
  v_from_rank := organization_edition_rank(coalesce(v_from, 'lite'));
  v_ceiling_rank := organization_edition_rank(v_ceiling_after);

  IF v_from_rank <= v_ceiling_rank THEN
    v_to := coalesce(v_from, 'lite');
  ELSE
    v_to := 'lite';
  END IF;

  UPDATE organizations
  SET status = 'licensed',
      data_purge_at = NULL
  WHERE id = p_org_id;

  IF v_from IS NULL THEN
    INSERT INTO organization_edition_state (
      organization_id, active_edition, changed_at, changed_by, change_reason
    )
    VALUES (p_org_id, v_to, v_now, NULL, 'trial_end');
  ELSE
    UPDATE organization_edition_state
    SET active_edition = v_to,
        changed_at = v_now,
        changed_by = NULL,
        change_reason = 'trial_end'
    WHERE organization_id = p_org_id;
  END IF;

  INSERT INTO organization_edition_events (
    organization_id, from_edition, to_edition, from_ceiling, to_ceiling,
    reason, actor_user_id
  )
  VALUES (
    p_org_id, v_from, v_to, v_ceiling_before, v_ceiling_after,
    'trial_end', NULL
  );

  PERFORM _sync_organization_edition_mirrors(p_org_id);

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION purge_expired_demo_organizations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_purged int := 0;
  v_converted int := 0;
  rec record;
BEGIN
  IF NOT editions_lifecycle_enabled() THEN
    FOR rec IN
      SELECT o.id
      FROM organizations o
      WHERE o.status IN ('demo_active', 'demo_retention')
        AND o.data_purge_at IS NOT NULL
        AND o.data_purge_at <= now()
        AND NOT organization_has_lifetime_license(o.id)
        AND NOT EXISTS (
          SELECT 1
          FROM organization_subscriptions os
          WHERE os.organization_id = o.id
            AND os.status IN ('active', 'past_due')
        )
        AND NOT (
          o.purchase_review_hold_until IS NOT NULL
          AND now() < o.purchase_review_hold_until
          AND _organization_has_eligible_purchase_review_new(o.id)
        )
      FOR UPDATE
    LOOP
      PERFORM _purge_demo_organization_core(rec.id, NULL, NULL, false, 'org.purged');
      v_purged := v_purged + 1;
    END LOOP;

    RETURN jsonb_build_object('purged_count', v_purged);
  END IF;

  FOR rec IN
    SELECT o.id
    FROM organizations o
    WHERE o.status IN ('demo_active', 'demo_retention')
      AND o.data_purge_at IS NOT NULL
      AND o.data_purge_at <= now()
      AND NOT organization_has_lifetime_license(o.id)
      AND NOT EXISTS (
        SELECT 1
        FROM organization_subscriptions os
        WHERE os.organization_id = o.id
          AND os.status IN ('active', 'past_due')
      )
      AND NOT (
        o.purchase_review_hold_until IS NOT NULL
        AND now() < o.purchase_review_hold_until
        AND _organization_has_eligible_purchase_review_new(o.id)
      )
    FOR UPDATE
  LOOP
    IF convert_expired_demo_to_lite(rec.id) THEN
      v_converted := v_converted + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('converted_count', v_converted, 'purged_count', 0);
END;
$$;

REVOKE ALL ON FUNCTION convert_expired_demo_to_lite(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION convert_expired_demo_to_lite(uuid) TO service_role;

REVOKE ALL ON FUNCTION purge_expired_demo_organizations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_expired_demo_organizations() TO service_role;

COMMIT;
