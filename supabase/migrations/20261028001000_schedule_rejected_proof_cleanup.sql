-- Runs the cleanup-rejected-proofs Edge Function every day at 03:30 UTC.
--
-- Before this works, store three secrets in Vault (Dashboard → Project
-- Settings → Vault, or SQL):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<anon key>', 'anon_key');
--   select vault.create_secret('<random string>', 'cleanup_cron_secret');
-- and set the same random string on the function:
--   supabase secrets set CLEANUP_CRON_SECRET=<random string>

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'cleanup-rejected-proof-images',
  '30 3 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/cleanup-rejected-proofs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
