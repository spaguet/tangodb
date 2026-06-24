-- Allow monthly_unlimited price type (prices_type_category_check was not updated in v2 migration).

ALTER TABLE prices DROP CONSTRAINT IF EXISTS prices_type_category_check;

ALTER TABLE prices ADD CONSTRAINT prices_type_category_check CHECK (
  (
    category = 'group'
    AND (
      type IN ('solo', 'pair_m1', 'pair_m2', 'pair_m3', 'pair_hm', 'monthly_unlimited')
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
