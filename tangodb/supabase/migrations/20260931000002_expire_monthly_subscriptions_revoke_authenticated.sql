-- H23 / S02: block PostgREST calls to expire_monthly_subscriptions (cross-tenant UPDATE).
-- Internal PERFORM from mark_attendance / freeze / partner-replacement remains (function owner).

REVOKE EXECUTE ON FUNCTION public.expire_monthly_subscriptions(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.expire_monthly_subscriptions(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.expire_monthly_subscriptions(uuid) FROM authenticated;
