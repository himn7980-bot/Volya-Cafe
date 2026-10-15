-- Run ONCE in the Supabase SQL editor of your hosted project, after:
--   1. Database → Extensions: enable pg_cron and pg_net.
--   2. npx supabase functions deploy push --no-verify-jwt
--   3. npx supabase secrets set PUSH_CRON_SECRET=<a long random string>
-- Replace the two placeholders below. They are stored in Supabase Vault, not in
-- your migrations or git.

select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/push', 'iou_push_url');
select vault.create_secret('<the same PUSH_CRON_SECRET>', 'iou_push_secret');

-- Send queued notifications every minute.
select cron.schedule(
  'iou-push',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'iou_push_url'),
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-push-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'iou_push_secret')
    ),
    body := '{}'::jsonb
  )
  $$
);

-- The daily due-date job ('iou-due-reminders', 06:00 UTC) is created by the
-- migrations when pg_cron is enabled. If you enabled pg_cron afterwards, run:
--   select cron.schedule('iou-due-reminders', '0 6 * * *', 'select public.run_due_reminders()');
