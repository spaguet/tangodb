-- Category for tariffs: group subscriptions vs personal lessons.
-- Enables custom tariffs without relying on hardcoded type keys in the frontend.

ALTER TABLE prices ADD COLUMN IF NOT EXISTS category TEXT;

UPDATE prices SET category = 'group'
WHERE category IS NULL
  AND (type IN ('solo', 'pair_hm', 'pair_m1', 'pair_m2', 'pair_m3') OR type LIKE 'pair_%');

UPDATE prices SET category = 'private'
WHERE category IS NULL
  AND type LIKE 'personal_%';

UPDATE prices SET category = 'group'
WHERE category IS NULL;

ALTER TABLE prices
  ADD CONSTRAINT prices_category_check CHECK (category IN ('group', 'private'));

ALTER TABLE prices ALTER COLUMN category SET NOT NULL;
