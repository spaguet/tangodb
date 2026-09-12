-- One-time ops: schedule expire-crm-subscriptions (same vault pattern as purge/renter worker).
-- Safe to re-run: unschedule first if job exists. Hourly is enough — UI read-only does not wait.

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'expire-crm-subscriptions';

SELECT cron.schedule(
  'expire-crm-subscriptions',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
           || '/functions/v1/expire-crm-subscriptions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
