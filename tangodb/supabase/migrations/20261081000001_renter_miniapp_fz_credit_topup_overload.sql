-- FZ / 2.9.62: drop ambiguous 6-arg _renter_credit_wallet_topup overload (FA6 added 7-arg with DEFAULT).

BEGIN;

DROP FUNCTION IF EXISTS _renter_credit_wallet_topup(uuid, uuid, numeric, text, uuid, uuid, text);

COMMIT;
