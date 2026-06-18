-- TangoDB v2 Phase 2A (B-1, B-2): greenfield business tables + cross-org FK guards
-- RLS and mark_attendance v2 — Phase 2B

-- =============================================================================
-- 0. Remove v1 single-tenant business objects (safe on greenfield v2-only DB)
-- =============================================================================

DROP TRIGGER IF EXISTS audit_clients ON clients;
DROP TRIGGER IF EXISTS audit_subscriptions ON subscriptions;
DROP TRIGGER IF EXISTS audit_personal_lessons ON personal_lessons;
DROP TRIGGER IF EXISTS audit_attendance ON attendance;
DROP TRIGGER IF EXISTS personal_lesson_subscription_guard ON personal_lessons;

DROP TABLE IF EXISTS attendance CASCADE;
DROP TABLE IF EXISTS personal_lessons CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS schedule CASCADE;
DROP TABLE IF EXISTS prices CASCADE;
DROP TABLE IF EXISTS clients CASCADE;
DROP TABLE IF EXISTS disciplines CASCADE;
DROP TABLE IF EXISTS audit_log CASCADE;

DROP FUNCTION IF EXISTS validate_personal_lesson_subscription();
DROP FUNCTION IF EXISTS audit_trigger_fn();
DROP FUNCTION IF EXISTS mark_attendance(text, text, text);
DROP FUNCTION IF EXISTS mark_personal_lesson_attendance(text, text);

-- =============================================================================
-- 1. Composite key on members (required for teacher_member_id FKs)
-- =============================================================================

ALTER TABLE organization_members
  ADD CONSTRAINT organization_members_org_id_unique UNIQUE (organization_id, id);

-- =============================================================================
-- 2. Tenant-scoped reference tables
-- =============================================================================

CREATE TABLE locations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  address         TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

CREATE UNIQUE INDEX locations_org_name_unique
  ON locations (organization_id, lower(trim(name)));

CREATE TABLE disciplines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

CREATE UNIQUE INDEX disciplines_org_name_unique
  ON disciplines (organization_id, lower(trim(name)));

CREATE TABLE classes (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  discipline_id           UUID NOT NULL,
  default_location_id     UUID,
  primary_teacher_member_id UUID,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, discipline_id)
    REFERENCES disciplines (organization_id, id),
  FOREIGN KEY (organization_id, default_location_id)
    REFERENCES locations (organization_id, id),
  FOREIGN KEY (organization_id, primary_teacher_member_id)
    REFERENCES organization_members (organization_id, id)
);

CREATE UNIQUE INDEX classes_org_name_discipline_unique
  ON classes (organization_id, lower(trim(name)), discipline_id);

CREATE TABLE class_teachers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  class_id        UUID NOT NULL,
  member_id       UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, class_id, member_id),
  FOREIGN KEY (organization_id, class_id)
    REFERENCES classes (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE CASCADE
);

-- =============================================================================
-- 3. Clients
-- =============================================================================

CREATE TABLE clients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  telegram        TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at     TIMESTAMPTZ,
  UNIQUE (organization_id, id)
);

CREATE UNIQUE INDEX clients_active_name_unique
  ON clients (organization_id, lower(trim(last_name)), lower(trim(first_name)))
  WHERE archived_at IS NULL;

CREATE INDEX idx_clients_org ON clients (organization_id) WHERE archived_at IS NULL;

-- =============================================================================
-- 4. Prices
-- =============================================================================

CREATE TABLE prices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  lessons         INTEGER NOT NULL CHECK (lessons >= 1),
  price           NUMERIC NOT NULL DEFAULT 0 CHECK (price >= 0),
  label           TEXT,
  description     TEXT,
  category        TEXT NOT NULL CHECK (category IN ('group', 'private')),
  UNIQUE (organization_id, type, lessons),
  UNIQUE (organization_id, id),
  CHECK (
    (
      category = 'group'
      AND type IN ('solo', 'pair_m1', 'pair_m2', 'pair_m3', 'pair_hm')
    )
    OR (
      category = 'private'
      AND type IN ('personal_solo', 'personal_pair', 'personal_trio')
    )
  )
);

-- =============================================================================
-- 5. Subscriptions
-- =============================================================================

CREATE TABLE subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  client_id1      UUID NOT NULL,
  client_id2      UUID,
  client_id3      UUID,
  lessons_total   INTEGER NOT NULL CHECK (lessons_total >= 1),
  lessons_left    INTEGER NOT NULL CHECK (lessons_left >= 0),
  freeze_used     INTEGER NOT NULL DEFAULT 0 CHECK (freeze_used >= 0),
  activation_date DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'finished')),
  pair_month      TEXT NOT NULL DEFAULT ''
    CHECK (pair_month IN ('', 'm1', 'm2', 'm3')),
  discipline_id   UUID,
  class_id        UUID,
  price_id        UUID,
  category        TEXT NOT NULL DEFAULT 'group'
    CHECK (category IN ('group', 'private')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  CHECK (lessons_left <= lessons_total),
  CHECK (
    (category = 'group' AND type IN ('solo', 'pair', 'pair_hm'))
    OR (category = 'private' AND type IN ('solo', 'pair', 'trio'))
  ),
  CHECK (
    (type = 'pair' AND pair_month IN ('m1', 'm2', 'm3'))
    OR (type IN ('pair_hm', 'solo', 'trio') AND pair_month = '')
    OR (category = 'private' AND pair_month = '')
  ),
  FOREIGN KEY (organization_id, client_id1)
    REFERENCES clients (organization_id, id),
  FOREIGN KEY (organization_id, client_id2)
    REFERENCES clients (organization_id, id),
  FOREIGN KEY (organization_id, client_id3)
    REFERENCES clients (organization_id, id),
  FOREIGN KEY (organization_id, discipline_id)
    REFERENCES disciplines (organization_id, id),
  FOREIGN KEY (organization_id, class_id)
    REFERENCES classes (organization_id, id),
  FOREIGN KEY (organization_id, price_id)
    REFERENCES prices (organization_id, id)
);

CREATE INDEX idx_subscriptions_org_status ON subscriptions (organization_id, status);
CREATE INDEX idx_subscriptions_org_discipline ON subscriptions (organization_id, discipline_id);

-- =============================================================================
-- 6. Attendance
-- =============================================================================

CREATE TABLE attendance (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  date              DATE NOT NULL,
  subscription_id   UUID NOT NULL,
  client_display    TEXT NOT NULL,
  attendance_status TEXT NOT NULL
    CHECK (attendance_status IN ('present', 'absent', 'freeze')),
  UNIQUE (organization_id, date, subscription_id),
  FOREIGN KEY (organization_id, subscription_id)
    REFERENCES subscriptions (organization_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_attendance_org_date ON attendance (organization_id, date);

-- =============================================================================
-- 7. Personal lessons
-- =============================================================================

CREATE TABLE personal_lessons (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  type              TEXT NOT NULL CHECK (type IN ('solo', 'pair', 'trio')),
  client_id1        UUID,
  client_id2        UUID,
  client_id3        UUID,
  date              DATE NOT NULL,
  time_start        TEXT NOT NULL DEFAULT '14:00',
  time_end          TEXT NOT NULL DEFAULT '15:00',
  price             NUMERIC NOT NULL DEFAULT 0 CHECK (price >= 0),
  paid              TEXT NOT NULL DEFAULT 'no' CHECK (paid IN ('yes', 'no')),
  discipline_id     UUID,
  subscription_id   UUID,
  location_id       UUID,
  teacher_member_id UUID,
  attendance_status TEXT CHECK (
    attendance_status IS NULL OR attendance_status IN ('present', 'absent')
  ),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, client_id1)
    REFERENCES clients (organization_id, id),
  FOREIGN KEY (organization_id, client_id2)
    REFERENCES clients (organization_id, id),
  FOREIGN KEY (organization_id, client_id3)
    REFERENCES clients (organization_id, id),
  FOREIGN KEY (organization_id, discipline_id)
    REFERENCES disciplines (organization_id, id),
  FOREIGN KEY (organization_id, subscription_id)
    REFERENCES subscriptions (organization_id, id),
  FOREIGN KEY (organization_id, location_id)
    REFERENCES locations (organization_id, id),
  FOREIGN KEY (organization_id, teacher_member_id)
    REFERENCES organization_members (organization_id, id)
);

CREATE INDEX idx_personal_lessons_org_date ON personal_lessons (organization_id, date);
CREATE INDEX idx_personal_lessons_org_teacher ON personal_lessons (organization_id, teacher_member_id);

-- =============================================================================
-- 8. Schedule slots (replaces v1 schedule)
-- =============================================================================

CREATE TABLE schedule_slots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  day_of_week       INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  time              TEXT NOT NULL,
  time_end          TEXT NOT NULL DEFAULT '21:00',
  discipline_id     UUID,
  class_id          UUID,
  location_id       UUID,
  teacher_member_id UUID,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, discipline_id)
    REFERENCES disciplines (organization_id, id),
  FOREIGN KEY (organization_id, class_id)
    REFERENCES classes (organization_id, id),
  FOREIGN KEY (organization_id, location_id)
    REFERENCES locations (organization_id, id),
  FOREIGN KEY (organization_id, teacher_member_id)
    REFERENCES organization_members (organization_id, id)
);

CREATE UNIQUE INDEX schedule_slots_no_discipline_unique
  ON schedule_slots (organization_id, day_of_week, time)
  WHERE discipline_id IS NULL;

CREATE UNIQUE INDEX schedule_slots_with_discipline_unique
  ON schedule_slots (organization_id, day_of_week, time, discipline_id)
  WHERE discipline_id IS NOT NULL;

CREATE INDEX idx_schedule_org_dow ON schedule_slots (organization_id, day_of_week);
CREATE INDEX idx_schedule_org_teacher ON schedule_slots (organization_id, teacher_member_id);

-- =============================================================================
-- 9. Audit log (tenant-scoped)
-- =============================================================================

CREATE TABLE audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  table_name      TEXT NOT NULL,
  operation       TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  row_id          TEXT NOT NULL,
  old_data        JSONB,
  new_data        JSONB,
  changed_by      UUID,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_org_changed ON audit_log (organization_id, changed_at DESC);

-- =============================================================================
-- 10. Cross-org guard: organization_id must match on INSERT/UPDATE
-- =============================================================================

CREATE OR REPLACE FUNCTION enforce_tenant_row_org_consistency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'class_teachers' THEN
    IF NOT EXISTS (
      SELECT 1 FROM classes c
      WHERE c.organization_id = NEW.organization_id AND c.id = NEW.class_id
    ) THEN
      RAISE EXCEPTION 'class_id does not belong to organization';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = NEW.organization_id AND om.id = NEW.member_id
    ) THEN
      RAISE EXCEPTION 'member_id does not belong to organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'subscriptions' THEN
    IF NEW.discipline_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM disciplines d
      WHERE d.organization_id = NEW.organization_id AND d.id = NEW.discipline_id
    ) THEN
      RAISE EXCEPTION 'discipline_id does not belong to organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'attendance' THEN
    IF NOT EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.organization_id = NEW.organization_id AND s.id = NEW.subscription_id
    ) THEN
      RAISE EXCEPTION 'subscription_id does not belong to organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'personal_lessons' THEN
    IF NEW.subscription_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.organization_id = NEW.organization_id AND s.id = NEW.subscription_id
    ) THEN
      RAISE EXCEPTION 'subscription_id does not belong to organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'schedule_slots' THEN
    IF NEW.discipline_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM disciplines d
      WHERE d.organization_id = NEW.organization_id AND d.id = NEW.discipline_id
    ) THEN
      RAISE EXCEPTION 'discipline_id does not belong to organization';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER subscriptions_org_consistency
  BEFORE INSERT OR UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_row_org_consistency();

CREATE TRIGGER attendance_org_consistency
  BEFORE INSERT OR UPDATE ON attendance
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_row_org_consistency();

CREATE TRIGGER personal_lessons_org_consistency
  BEFORE INSERT OR UPDATE ON personal_lessons
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_row_org_consistency();

CREATE TRIGGER schedule_slots_org_consistency
  BEFORE INSERT OR UPDATE ON schedule_slots
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_row_org_consistency();

CREATE TRIGGER class_teachers_org_consistency
  BEFORE INSERT OR UPDATE ON class_teachers
  FOR EACH ROW EXECUTE FUNCTION enforce_tenant_row_org_consistency();

-- =============================================================================
-- 11. Personal lesson ↔ private subscription package guard
-- =============================================================================

CREATE OR REPLACE FUNCTION validate_personal_lesson_subscription()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_sub RECORD;
BEGIN
  IF NEW.subscription_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_sub
  FROM subscriptions
  WHERE id = NEW.subscription_id
    AND organization_id = NEW.organization_id;

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
      OR NEW.client_id2 IS NOT NULL
      OR NEW.client_id3 IS NOT NULL THEN
      RAISE EXCEPTION 'Клиент урока не совпадает с владельцем пакета';
    END IF;
  ELSIF v_sub.type = 'pair' THEN
    IF NEW.client_id1 IS DISTINCT FROM v_sub.client_id1
      OR NEW.client_id2 IS DISTINCT FROM v_sub.client_id2
      OR NEW.client_id3 IS NOT NULL THEN
      RAISE EXCEPTION 'Клиенты урока не совпадают с владельцами пакета';
    END IF;
  ELSIF v_sub.type = 'trio' THEN
    IF NEW.client_id1 IS DISTINCT FROM v_sub.client_id1
      OR NEW.client_id2 IS DISTINCT FROM v_sub.client_id2
      OR NEW.client_id3 IS DISTINCT FROM v_sub.client_id3 THEN
      RAISE EXCEPTION 'Клиенты урока не совпадают с владельцами пакета';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER personal_lesson_subscription_guard
  BEFORE INSERT OR UPDATE OF subscription_id, client_id1, client_id2, client_id3
  ON personal_lessons
  FOR EACH ROW
  EXECUTE FUNCTION validate_personal_lesson_subscription();

-- =============================================================================
-- 12. Audit triggers (changed_by = auth.uid())
-- =============================================================================

CREATE OR REPLACE FUNCTION audit_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid;
  v_row_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_org_id := OLD.organization_id;
    v_row_id := OLD.id::text;
  ELSE
    v_org_id := NEW.organization_id;
    v_row_id := NEW.id::text;
  END IF;

  INSERT INTO audit_log (
    organization_id,
    table_name,
    operation,
    row_id,
    old_data,
    new_data,
    changed_by
  )
  VALUES (
    v_org_id,
    TG_TABLE_NAME,
    TG_OP,
    v_row_id,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    auth.uid()
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER audit_clients
  AFTER INSERT OR UPDATE OR DELETE ON clients
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_subscriptions
  AFTER INSERT OR UPDATE OR DELETE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_personal_lessons
  AFTER INSERT OR UPDATE OR DELETE ON personal_lessons
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_attendance
  AFTER INSERT OR UPDATE OR DELETE ON attendance
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
