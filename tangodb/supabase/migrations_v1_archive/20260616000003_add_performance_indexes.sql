-- Performance indexes for frequently queried columns (attendance, subscriptions, personal_lessons)

-- Attendance: date lookup for journal, subscription_id for mark_attendance JOIN
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance (date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_subscription_id ON attendance (subscription_id);

-- Subscriptions: active filter, client lookup, activation ordering
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions (status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_subscriptions_client_id1 ON subscriptions (client_id1);
CREATE INDEX IF NOT EXISTS idx_subscriptions_activation_date ON subscriptions (activation_date DESC);

-- Personal lessons: date filter, client and subscription lookup
CREATE INDEX IF NOT EXISTS idx_personal_lessons_date ON personal_lessons (date DESC);
CREATE INDEX IF NOT EXISTS idx_personal_lessons_client_id1 ON personal_lessons (client_id1);
CREATE INDEX IF NOT EXISTS idx_personal_lessons_subscription_id ON personal_lessons (subscription_id) WHERE subscription_id IS NOT NULL;
