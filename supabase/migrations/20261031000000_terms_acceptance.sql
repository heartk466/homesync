-- Terms of Service & Privacy Policy acceptance.
-- New accounts see the agreement once, on their first sign-in (any device);
-- accepting stamps terms_accepted_at. Existing accounts are marked as accepted
-- so they aren't interrupted.
-- Run it ONCE per database: running it again would mark new accounts that
-- haven't agreed yet as accepted.

alter table public.profiles add column if not exists terms_accepted_at timestamptz;

-- everyone who already has an account when this runs
update public.profiles
   set terms_accepted_at = coalesce(created_at, now())
 where terms_accepted_at is null;
