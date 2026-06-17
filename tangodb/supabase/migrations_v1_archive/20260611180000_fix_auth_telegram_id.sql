-- Fix RLS: use auth.jwt() (Supabase-native) with fallbacks for telegram_id
CREATE OR REPLACE FUNCTION auth_telegram_id() RETURNS BIGINT AS $$
  SELECT COALESCE(
    NULLIF(auth.jwt()->>'telegram_id', '')::BIGINT,
    NULLIF(auth.jwt()->'app_metadata'->>'telegram_id', '')::BIGINT,
    NULLIF(auth.jwt()->'user_metadata'->>'telegram_id', '')::BIGINT,
    (regexp_match(auth.jwt()->>'email', '^tg_(\d+)@tangodb\.auth$'))[1]::BIGINT
  );
$$ LANGUAGE sql STABLE;
