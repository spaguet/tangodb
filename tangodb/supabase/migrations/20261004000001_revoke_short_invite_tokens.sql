-- S01 / C1: short invite tokens (8 chars × alphabet 32) are no longer accepted.
-- Pending invites must be re-sent after this migration; new tokens are 128-bit CSPRNG.

UPDATE organization_invites
SET revoked_at = now()
WHERE accepted_at IS NULL
  AND revoked_at IS NULL;
