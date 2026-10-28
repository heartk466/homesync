-- Tighten name_change_requests:
--   • a rename request (or the owner's rename log) can only be created for a
--     household / group the user belongs to
--   • a member's request always starts clean: pending, no reason, unresolved

drop policy if exists "members create own name requests" on public.name_change_requests;
create policy "members create own name requests"
on public.name_change_requests
for insert
with check (
  requested_by = auth.uid()
  and (
    (household_id is not null and exists (
      select 1 from public.household_members m
      where m.household_id = name_change_requests.household_id
        and m.user_id = auth.uid() and m.status = 'active'
    ))
    or (group_id is not null and exists (
      select 1 from public.group_members gm
      where gm.group_id = name_change_requests.group_id and gm.user_id = auth.uid()
    ))
    or public.name_request_owner(household_id, group_id) = auth.uid()
  )
);

create or replace function public.guard_name_change_request()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  -- the owner renames directly; those rows are just the log
  if new.requested_by = public.name_request_owner(new.household_id, new.group_id) then
    return new;
  end if;

  if exists (
    select 1 from name_change_requests r
    where r.requested_by = new.requested_by and r.status = 'pending'
      and (r.household_id = new.household_id or r.group_id = new.group_id)
  ) then
    raise exception 'NAME_CHANGE_PENDING: Your rename request is still waiting for the owner.';
  end if;

  if public.name_requests_used_this_month(new.household_id, new.group_id, new.requested_by) >= 2 then
    raise exception 'NAME_CHANGE_LIMIT: You used up your 2 name change requests this month. Try again next month.';
  end if;

  new.status := 'pending';
  new.rejection_reason := null;
  new.resolved_by := null;
  new.resolved_at := null;
  return new;
end;
$$;
