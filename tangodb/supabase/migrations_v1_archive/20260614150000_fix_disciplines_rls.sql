-- disciplines was added after is_allowed_teacher() RLS fix; align its policies.

DROP POLICY IF EXISTS "teacher_select" ON disciplines;
CREATE POLICY "teacher_select" ON disciplines FOR SELECT
  USING (is_allowed_teacher());

DROP POLICY IF EXISTS "teacher_insert" ON disciplines;
CREATE POLICY "teacher_insert" ON disciplines FOR INSERT
  WITH CHECK (is_allowed_teacher());

DROP POLICY IF EXISTS "teacher_update" ON disciplines;
CREATE POLICY "teacher_update" ON disciplines FOR UPDATE
  USING (is_allowed_teacher())
  WITH CHECK (is_allowed_teacher());

DROP POLICY IF EXISTS "teacher_delete" ON disciplines;
CREATE POLICY "teacher_delete" ON disciplines FOR DELETE
  USING (is_allowed_teacher());
