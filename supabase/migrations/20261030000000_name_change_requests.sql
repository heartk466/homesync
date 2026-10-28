-- Rename requests for households / groups
--   • the owner rejects with a reason (shown to the member)
--   • a member can send at most 2 requests per household/group per month
--     (Asia/Manila calendar month), and only one can be pending at a time
--   • the owner's own renames are logged here too (status 'approved'), so the
--     "Export My Data" PDF can list every name change of the month

create table if not exists public.name_change_requests (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id) on delete cascade,
  group_id uuid references public.groups(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  old_name text not null,
  new_name text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

alter table public.name_change_requests add column if not exists rejection_reason text;
alter table public.name_change_requests add column if not exists resolved_at timestamptz;
alter table public.name_change_requests add column if not exists resolved_by uuid references public.profiles(id) on delete set null;

create index if not exists name_change_requests_household_idx on public.name_change_requests (household_id, created_at);
create index if not exists name_change_requests_group_idx on public.name_change_requests (group_id, created_at);

-- Owner of the household / group a request belongs to
create or replace function public.name_request_owner(p_household uuid, p_group uuid)
returns uuid
language sql
stable
security definer
set search_path = 'public'
as $$
  select case
    when p_household is not null then (select created_by from households where id = p_household)
    else (select created_by from groups where id = p_group)
  end;
$$;

-- Requests this member has used this month for this household / group
create or replace function public.name_requests_used_this_month(p_household uuid, p_group uuid, p_user uuid)
returns integer
language sql
stable
security definer
set search_path = 'public'
as $$
  select count(*)::integer
  from name_change_requests r
  where r.requested_by = p_user
    and r.requested_by is distinct from public.name_request_owner(r.household_id, r.group_id)
    and (r.household_id = p_household or r.group_id = p_group)
    and (r.created_at at time zone 'Asia/Manila') >= date_trunc('month', now() at time zone 'Asia/Manila');
$$;
grant execute on function public.name_requests_used_this_month(uuid, uuid, uuid) to authenticated;

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
  return new;
end;
$$;

drop trigger if exists trg_guard_name_change_request on public.name_change_requests;
create trigger trg_guard_name_change_request
before insert on public.name_change_requests
for each row execute function public.guard_name_change_request();

-- Name changes of a household in a date range (approved requests + the owner's
-- own renames) for "Export My Data". Members only.
create or replace function public.household_name_history(p_household uuid, p_from date, p_to date)
returns table (old_name text, new_name text, requested_by_name text, approved_by_name text, changed_at timestamptz, by_owner boolean)
language sql
stable
security definer
set search_path = 'public'
as $$
  select r.old_name, r.new_name,
         coalesce(rp.full_name, 'Former member'),
         coalesce(ap.full_name, rp.full_name, 'Owner'),
         coalesce(r.resolved_at, r.created_at),
         r.resolved_by is not distinct from r.requested_by
  from name_change_requests r
  left join profiles rp on rp.id = r.requested_by
  left join profiles ap on ap.id = r.resolved_by
  where r.household_id = p_household
    and r.status = 'approved'
    and (coalesce(r.resolved_at, r.created_at) at time zone 'Asia/Manila')::date between p_from and p_to
    and exists (
      select 1 from household_members m
      where m.household_id = p_household and m.user_id = auth.uid() and m.status = 'active'
    )
  order by coalesce(r.resolved_at, r.created_at);
$$;
grant execute on function public.household_name_history(uuid, date, date) to authenticated;
