-- One-time ops: schedule renter-booking-worker (same vault pattern as calendar-sync-worker).
-- Safe to re-run: unschedule first if job exists.

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'renter-booking-worker';

SELECT cron.schedule(
  'renter-booking-worker',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
           || '/functions/v1/renter-booking-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
