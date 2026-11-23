-- profiles.household_id must only point to a household the user is still an
-- active member of. Members removed before remove_household_member() cleared it
-- (or removed by any other path) kept the old household's id.
--
-- 1) repair: clear it wherever the membership is no longer active
-- 2) keep it in sync: when a membership stops being active (left / kicked /
--    household deleted / row removed), clear that user's profile pointer too
-- Safe to run more than once.

update public.profiles p
   set household_id = null
 where p.household_id is not null
   and not exists (
     select 1 from public.household_members hm
      where hm.user_id = p.id
        and hm.household_id = p.household_id
        and hm.status = 'active'
   );

create or replace function public.clear_profile_household_on_leave()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'active' and (tg_op = 'DELETE' or new.status is distinct from 'active') then
    update public.profiles
       set household_id = null
     where id = old.user_id
       and household_id = old.household_id;
  end if;
  return null;
end;
$$;

revoke all on function public.clear_profile_household_on_leave() from public, anon, authenticated;

drop trigger if exists trg_clear_profile_household_on_leave on public.household_members;
create trigger trg_clear_profile_household_on_leave
after update of status or delete on public.household_members
for each row execute function public.clear_profile_household_on_leave();
