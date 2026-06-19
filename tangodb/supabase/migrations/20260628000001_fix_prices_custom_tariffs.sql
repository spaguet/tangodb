-- Fix creating custom tariffs: RLS requires organization_id; CHECK blocked tariff_* types.

ALTER TABLE prices
  ALTER COLUMN organization_id SET DEFAULT auth_organization_id();

ALTER TABLE prices DROP CONSTRAINT IF EXISTS prices_check;

ALTER TABLE prices ADD CONSTRAINT prices_type_category_check CHECK (
  (
    category = 'group'
    AND (
      type IN ('solo', 'pair_m1', 'pair_m2', 'pair_m3', 'pair_hm')
      OR type ~ '^tariff_[a-f0-9]{12}$'
    )
  )
  OR (
    category = 'private'
    AND (
      type IN ('personal_solo', 'personal_pair', 'personal_trio')
      OR type ~ '^tariff_[a-f0-9]{12}$'
    )
  )
);
