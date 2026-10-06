-- E6c smoke: edition metrics + billing search RPC

BEGIN;

SELECT _test_assert(
  (dev_console_edition_metrics() ->> 'org_count') IS NOT NULL,
  'dev_console_edition_metrics returns org_count'
);

SELECT _test_assert(
  jsonb_typeof(dev_console_search_billing(NULL, NULL, 5)) = 'array',
  'dev_console_search_billing returns json array'
);

ROLLBACK;
