-- Remove sign-ups that were never verified (wrong or mistyped email): every
-- day at 03:00 Asia/Manila (19:00 UTC), delete auth users whose email is still
-- unconfirmed 24 hours after signing up. With email confirmation on they have
-- no profile or household yet, so nothing else is affected; the address can be
-- used to sign up again.
-- Safe to run more than once.

create extension if not exists pg_cron;

create or replace function public.cleanup_unverified_signups()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from auth.users u
   where u.email_confirmed_at is null
     and u.created_at < now() - interval '24 hours'
     and not exists (select 1 from public.profiles p where p.id = u.id);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_unverified_signups() from public, anon, authenticated;

select cron.schedule(
  'cleanup-unverified-signups',
  '0 19 * * *',
  $$ select public.cleanup_unverified_signups(); $$
);
