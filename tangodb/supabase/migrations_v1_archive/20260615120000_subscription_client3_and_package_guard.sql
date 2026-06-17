-- Bind personal lesson packages to specific clients; block mismatched bookings.

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS client_id3 TEXT REFERENCES clients(id);

CREATE OR REPLACE FUNCTION validate_personal_lesson_subscription()
RETURNS TRIGGER AS $$
DECLARE
  v_sub RECORD;
BEGIN
  IF NEW.subscription_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_sub FROM subscriptions WHERE id = NEW.subscription_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Абонемент не найден';
  END IF;

  IF v_sub.category <> 'private' THEN
    RAISE EXCEPTION 'К персональному уроку можно привязать только персональный пакет';
  END IF;

  IF v_sub.status <> 'active' OR v_sub.lessons_left <= 0 THEN
    RAISE EXCEPTION 'Пакет неактивен или исчерпан';
  END IF;

  IF v_sub.type = 'solo' THEN
    IF NEW.client_id1 IS DISTINCT FROM v_sub.client_id1
      OR COALESCE(NEW.client_id2, '') <> ''
      OR COALESCE(NEW.client_id3, '') <> '' THEN
      RAISE EXCEPTION 'Клиент урока не совпадает с владельцем пакета';
    END IF;
  ELSIF v_sub.type = 'pair' THEN
    IF NEW.client_id1 IS DISTINCT FROM v_sub.client_id1
      OR NEW.client_id2 IS DISTINCT FROM v_sub.client_id2
      OR COALESCE(NEW.client_id3, '') <> '' THEN
      RAISE EXCEPTION 'Клиенты урока не совпадают с владельцами пакета';
    END IF;
  ELSIF v_sub.type = 'trio' THEN
    IF NEW.client_id1 IS DISTINCT FROM v_sub.client_id1
      OR NEW.client_id2 IS DISTINCT FROM v_sub.client_id2
      OR NEW.client_id3 IS DISTINCT FROM v_sub.client_id3 THEN
      RAISE EXCEPTION 'Клиенты урока не совпадают с владельцами пакета';
    END IF;
  ELSE
    IF NEW.client_id1 IS DISTINCT FROM v_sub.client_id1
      OR COALESCE(NEW.client_id2, '') IS DISTINCT FROM COALESCE(v_sub.client_id2, '')
      OR COALESCE(NEW.client_id3, '') IS DISTINCT FROM COALESCE(v_sub.client_id3, '') THEN
      RAISE EXCEPTION 'Клиенты урока не совпадают с владельцами пакета';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS personal_lesson_subscription_guard ON personal_lessons;
CREATE TRIGGER personal_lesson_subscription_guard
  BEFORE INSERT OR UPDATE OF subscription_id, client_id1, client_id2, client_id3
  ON personal_lessons
  FOR EACH ROW
  EXECUTE FUNCTION validate_personal_lesson_subscription();

-- Include third client in attendance display for trio packages.
CREATE OR REPLACE FUNCTION mark_attendance(
  p_date TEXT,
  p_sub_id TEXT,
  p_new_status TEXT
) RETURNS JSONB AS $$
DECLARE
  v_sub RECORD;
  v_old_status TEXT;
  v_lesson_delta INT := 0;
  v_freeze_delta INT := 0;
  v_new_lessons_left INT;
  v_new_freeze_used INT;
  v_display TEXT := '';
  v_c1 RECORD;
  v_c2 RECORD;
  v_c3 RECORD;
  v_today DATE := CURRENT_DATE;
BEGIN
  IF p_date::DATE > v_today THEN
    RETURN jsonb_build_object('success', false, 'error', 'Отметки доступны только за прошедшие и текущий день');
  END IF;

  SELECT * INTO v_sub FROM subscriptions WHERE id = p_sub_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Абонемент не найден');
  END IF;

  IF v_sub.category = 'private' AND p_new_status = 'freeze' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Заморозка недоступна для персональных абонементов');
  END IF;

  SELECT attendance_status INTO v_old_status
  FROM attendance WHERE date = p_date::DATE AND subscription_id = p_sub_id;

  IF v_old_status IS NOT DISTINCT FROM p_new_status THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  IF v_old_status IN ('present','absent') THEN v_lesson_delta := 1; END IF;
  IF v_old_status = 'freeze' THEN v_freeze_delta := -1; END IF;

  IF p_new_status IN ('present','absent') THEN v_lesson_delta := v_lesson_delta - 1; END IF;
  IF p_new_status = 'freeze' THEN v_freeze_delta := v_freeze_delta + 1; END IF;

  IF v_old_status IN ('present','absent') AND p_new_status IN ('present','absent') THEN
    v_lesson_delta := 0;
  END IF;

  IF p_new_status = 'freeze' THEN
    IF v_sub.lessons_total != 8 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Заморозка только для абонементов на 8 уроков');
    END IF;
    IF v_sub.freeze_used + v_freeze_delta > 1 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Заморозка уже использована');
    END IF;
  END IF;

  v_new_lessons_left := v_sub.lessons_left + v_lesson_delta;
  IF v_new_lessons_left < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно уроков');
  END IF;
  v_new_freeze_used := v_sub.freeze_used + v_freeze_delta;

  SELECT last_name, first_name INTO v_c1 FROM clients WHERE id = v_sub.client_id1;
  IF FOUND THEN
    v_display := v_c1.last_name || ' ' || v_c1.first_name;
  ELSE
    v_display := v_sub.client_id1;
  END IF;
  IF v_sub.client_id2 IS NOT NULL AND v_sub.client_id2 <> '' THEN
    SELECT last_name, first_name INTO v_c2 FROM clients WHERE id = v_sub.client_id2;
    IF FOUND THEN
      v_display := v_display || ' & ' || v_c2.last_name || ' ' || v_c2.first_name;
    END IF;
  END IF;
  IF v_sub.client_id3 IS NOT NULL AND v_sub.client_id3 <> '' THEN
    SELECT last_name, first_name INTO v_c3 FROM clients WHERE id = v_sub.client_id3;
    IF FOUND THEN
      v_display := v_display || ' & ' || v_c3.last_name || ' ' || v_c3.first_name;
    END IF;
  END IF;

  INSERT INTO attendance (date, subscription_id, client_display, attendance_status)
  VALUES (p_date::DATE, p_sub_id, v_display, p_new_status)
  ON CONFLICT (date, subscription_id)
  DO UPDATE SET attendance_status = p_new_status, client_display = v_display;

  UPDATE subscriptions SET
    lessons_left = v_new_lessons_left,
    freeze_used  = v_new_freeze_used,
    status = CASE WHEN v_new_lessons_left = 0 THEN 'finished' ELSE status END
  WHERE id = p_sub_id;

  RETURN jsonb_build_object('success', true, 'newLessonsLeft', v_new_lessons_left);
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION mark_attendance(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_attendance(TEXT, TEXT, TEXT) TO authenticated;
