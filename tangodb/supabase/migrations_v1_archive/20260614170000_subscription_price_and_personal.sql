-- Link subscriptions to tariffs; support personal lesson packages.

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS price_id INTEGER REFERENCES prices(id);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'group';

UPDATE subscriptions SET category = 'group' WHERE category IS NULL;

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_category_check;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_category_check CHECK (category IN ('group', 'private'));

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_type_check;
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_lessons_total_check;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_lessons_total_check CHECK (lessons_total >= 1);

-- Backfill price_id for existing group subscriptions
UPDATE subscriptions s
SET price_id = p.id
FROM prices p
WHERE s.price_id IS NULL
  AND s.category = 'group'
  AND (
    (s.type = 'solo' AND p.type = 'solo' AND p.lessons = s.lessons_total)
    OR (s.type = 'pair_hm' AND p.type = 'pair_hm' AND p.lessons = s.lessons_total)
    OR (
      s.type = 'pair'
      AND p.type = 'pair_m' || COALESCE(NULLIF(s.pair_month, ''), '1')
      AND p.lessons = s.lessons_total
    )
  );

ALTER TABLE personal_lessons ADD COLUMN IF NOT EXISTS subscription_id TEXT REFERENCES subscriptions(id);
