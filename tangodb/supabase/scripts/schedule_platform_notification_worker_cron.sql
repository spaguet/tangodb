-- One-time ops: schedule platform-notification-worker (same vault pattern as renter-booking-worker).
-- Safe to re-run: unschedule first if job exists.

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'platform-notification-worker';

SELECT cron.schedule(
  'platform-notification-worker',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
           || '/functions/v1/platform-notification-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
