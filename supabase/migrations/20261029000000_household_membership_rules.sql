-- Household membership rules (enforced here, not just in the app)
--
--   • exactly one owner per household; ownership changes only by an accepted
--     transfer request (or a majority-approved claim when the owner has been
--     inactive 30+ days)
--   • nobody leaves / is removed while they owe unpaid shares, have proofs
--     waiting for their review, or have a refund waiting for their confirmation
--   • the owner can't leave while other members remain; a sole member deletes
--     the household instead
--   • leaving keeps every expense, payment and proof; the person shows as a
--     "former member" (name + avatar only — their payment details stay hidden)
--
-- Membership / ownership changes go through the RPCs below, which set the
-- transaction flag homesync.membership_rpc; the guard triggers reject the same
-- changes made directly. Safe to re-run.

begin;

-- ── Activity (for "owner inactive 30 days") ──
alter table public.profiles add column if not exists last_active_at timestamptz default now();

create or replace function public.touch_last_active()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set last_active_at = now()
  where id = auth.uid()
    and (last_active_at is null or last_active_at < now() - interval '10 minutes');
$$;
revoke all on function public.touch_last_active() from public, anon;
grant execute on function public.touch_last_active() to authenticated;

-- ── Ownership requests ──
create table if not exists public.household_ownership_requests (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  kind         text not null check (kind in ('transfer', 'claim')),
  from_user    uuid not null,              -- owner at request time
  to_user      uuid not null,              -- would-be owner
  requested_by uuid not null,
  status       text not null default 'pending'
               check (status in ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  expires_at   timestamptz not null default now() + interval '7 days',
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index if not exists household_ownership_requests_household_idx on public.household_ownership_requests (household_id, status);

create table if not exists public.household_ownership_votes (
  request_id uuid not null references public.household_ownership_requests(id) on delete cascade,
  voter_id   uuid not null,
  approve    boolean not null,
  created_at timestamptz not null default now(),
  primary key (request_id, voter_id)
);

alter table public.household_ownership_requests enable row level security;
alter table public.household_ownership_votes enable row level security;
drop policy if exists ownership_requests_read on public.household_ownership_requests;
create policy ownership_requests_read on public.household_ownership_requests for select to authenticated
using (public.is_active_household_member(household_id) or from_user = auth.uid() or to_user = auth.uid());
drop policy if exists ownership_votes_read on public.household_ownership_votes;
create policy ownership_votes_read on public.household_ownership_votes for select to authenticated
using (exists (
  select 1 from public.household_ownership_requests r
  where r.id = request_id and public.is_active_household_member(r.household_id)
));
-- no insert/update/delete policies: only the RPCs below write these tables

-- ── Helpers ──
create or replace function public.membership_rpc_on()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(current_setting('homesync.membership_rpc', true), '') = 'on';
$$;

create or replace function public.notify_household(p_household uuid, p_except uuid, p_title text, p_message text, p_type text, p_query text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, title, message, type, link_path, link_query)
  -- no query = information only (e.g. "Member Left"), so no tap target
  select hm.user_id, p_title, p_message, p_type, case when p_query is null then null else '/settings' end, p_query
  from public.household_members hm
  where hm.household_id = p_household and hm.status = 'active'
    and hm.user_id is distinct from p_except;
$$;
revoke all on function public.notify_household(uuid, uuid, text, text, text, text) from public, anon, authenticated;

-- What stops p_user from leaving p_household (empty array = free to go):
--   unpaid_share   – their own unpaid / partly paid share
--   proof_review   – payment or follow-up proofs waiting for them (owner)
--   refund_review  – a refund sent to them, waiting for their confirmation
create or replace function public.household_leave_blockers(p_household uuid, p_user uuid default auth.uid())
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  v_owner uuid;
  v_out jsonb := '[]'::jsonb;
begin
  select created_by into v_owner from households where id = p_household;
  -- only the person themselves or the owner may ask
  if auth.uid() is not null and auth.uid() is distinct from p_user and auth.uid() is distinct from v_owner then
    raise exception 'Not allowed';
  end if;

  select v_out || coalesce(jsonb_agg(jsonb_build_object(
           'kind', 'unpaid_share', 'expense_id', e.id, 'title', e.title,
           'amount', round(s.share_amount - case when s.status = 'partly_paid' then coalesce(s.paid_amount, 0) else 0 end, 2)
         ) order by e.expense_date), '[]'::jsonb)
    into v_out
  from expense_splits s
  join expenses e on e.id = s.expense_id
  where e.household_id = p_household and e.deleted_at is null and e.approval_status = 'approved'
    and s.user_id = p_user and s.status in ('unpaid', 'partly_paid') and s.share_amount > 0
    and split_deletion_state(s.expense_id, s.user_id, s.paid_amount) is null;

  if p_user = v_owner then
    select v_out || coalesce(jsonb_agg(jsonb_build_object(
             'kind', 'proof_review', 'expense_id', e.id, 'title', e.title, 'proof_id', s.proof_id,
             'member', coalesce(p.full_name, 'A member'), 'amount', round(s.share_amount, 2)
           )), '[]'::jsonb)
      into v_out
    from expense_splits s
    join expenses e on e.id = s.expense_id
    left join profiles p on p.id = s.user_id
    where e.household_id = p_household and e.deleted_at is null
      and s.status = 'pending_verification' and s.user_id <> p_user;

    select v_out || coalesce(jsonb_agg(jsonb_build_object(
             'kind', 'proof_review', 'expense_id', e.id, 'title', e.title, 'followup_id', f.id,
             'member', coalesce(p.full_name, 'A member'), 'amount', round(f.amount, 2)
           )), '[]'::jsonb)
      into v_out
    from expense_followup_proofs f
    join expenses e on e.id = f.expense_id
    left join profiles p on p.id = f.user_id
    where e.household_id = p_household and e.deleted_at is null
      and f.status = 'pending_verification' and f.user_id <> p_user;
  end if;

  select v_out || coalesce(jsonb_agg(jsonb_build_object(
           'kind', 'refund_review', 'expense_id', e.id, 'title', e.title, 'refund_id', x.id, 'amount', round(x.amount, 2)
         )), '[]'::jsonb)
    into v_out
  from expense_refunds x
  join expenses e on e.id = x.expense_id
  where e.household_id = p_household and x.user_id = p_user and x.status = 'sent';

  return v_out;
end;
$$;
revoke all on function public.household_leave_blockers(uuid, uuid) from public, anon;
grant execute on function public.household_leave_blockers(uuid, uuid) to authenticated;

-- ── Guards: direct changes outside the RPCs ──
create or replace function public.guard_membership_update_for_rls()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null or public.membership_rpc_on() then
    return new;
  end if;
  if tg_table_name = 'household_members' then
    if new.role is distinct from old.role then
      raise exception 'Ownership changes only through an accepted transfer request';
    end if;
    if old.status = 'active' and new.status is distinct from 'active' then
      -- Only "inactive" on yourself (account deletion), under the same rules as leaving
      if old.user_id = auth.uid() and new.user_id = old.user_id and new.status = 'inactive'
         and not (old.role = 'owner' and exists (
           select 1 from public.household_members o
           where o.household_id = old.household_id and o.status = 'active' and o.user_id <> old.user_id))
         and jsonb_array_length(public.household_leave_blockers(old.household_id, old.user_id)) = 0 then
        return new;
      end if;
      raise exception 'Use Leave household / Remove member in the app (unpaid shares and pending reviews must be settled first)';
    end if;
  end if;
  if tg_table_name = 'household_members' then
    if exists (select 1 from public.households h where h.id = old.household_id and h.created_by = auth.uid()) then
      return new;
    end if;
  elsif exists (select 1 from public.groups g where g.id = old.group_id and g.created_by = auth.uid()) then
    return new;
  end if;
  if old.user_id = auth.uid() and new.user_id = old.user_id and new.role = old.role and new.status = 'inactive' then
    return new;
  end if;
  raise exception 'Only the owner can change membership';
end;
$$;

create or replace function public.guard_household_membership_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and not public.membership_rpc_on() then
    raise exception 'Members are never deleted — use Leave household / Remove member';
  end if;
  return old;
end;
$$;
drop trigger if exists trg_guard_household_membership_delete on public.household_members;
create trigger trg_guard_household_membership_delete
before delete on public.household_members
for each row execute function public.guard_household_membership_delete();

create or replace function public.guard_household_owner_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is null or public.membership_rpc_on() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Use Delete household in Settings';
  end if;
  if new.created_by is distinct from old.created_by then
    raise exception 'Ownership changes only through an accepted transfer request';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_household_owner_change on public.households;
create trigger trg_guard_household_owner_change
before update or delete on public.households
for each row execute function public.guard_household_owner_change();

-- ── Swap owner (inside the RPCs) ──
create or replace function public.apply_ownership_change(p_request uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  r household_ownership_requests;
  v_name text;
  v_hh text;
  v_pending integer;
begin
  select * into r from household_ownership_requests where id = p_request for update;
  perform set_config('homesync.membership_rpc', 'on', true);

  update households set created_by = r.to_user where id = r.household_id;
  update household_members set role = 'member' where household_id = r.household_id and role = 'owner';
  update household_members set role = 'owner' where household_id = r.household_id and user_id = r.to_user;
  update household_ownership_requests set status = 'accepted', resolved_at = now() where id = r.id;
  update household_ownership_requests set status = 'cancelled', resolved_at = now()
  where household_id = r.household_id and status = 'pending' and id <> r.id;

  select full_name into v_name from profiles where id = r.to_user;
  select name into v_hh from households where id = r.household_id;
  v_name := coalesce(v_name, 'A member');

  -- Everyone: new owner + "payment details changed" (members now pay the new owner)
  perform notify_household(r.household_id, r.to_user, '👑 New Household Owner',
    format('%s is now the owner of "%s". Payment details changed — pay %s from now on.', v_name, v_hh, v_name),
    'ownership_changed', 'household=' || r.household_id);

  -- Pending proof reviews now belong to the new owner
  select count(*) into v_pending
  from expense_splits s join expenses e on e.id = s.expense_id
  where e.household_id = r.household_id and e.deleted_at is null
    and s.status = 'pending_verification' and s.user_id <> r.to_user;
  insert into notifications (user_id, title, message, type, link_path, link_query)
  values (r.to_user, '👑 You are now the owner',
    format('You now own "%s". You approve payment proofs, manage members and settings.%s', v_hh,
      case when v_pending > 0 then format(' %s payment proof%s waiting for your review.', v_pending, case when v_pending = 1 then ' is' else 's are' end) else '' end),
    'ownership_changed', case when v_pending > 0 then '/expenses' else '/settings' end,
    case when v_pending > 0 then 'householdId=' || r.household_id else null end);
end;
$$;
revoke all on function public.apply_ownership_change(uuid) from public, anon, authenticated;

create or replace function public.expire_ownership_requests()
returns void language sql security definer set search_path = '' as $$
  update public.household_ownership_requests
  set status = 'expired', resolved_at = now()
  where status = 'pending' and expires_at < now();
$$;
revoke all on function public.expire_ownership_requests() from public, anon, authenticated;

-- ── RPCs ──
create or replace function public.request_ownership_transfer(p_household uuid, p_to uuid)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_id uuid;
  v_hh text;
  v_from text;
begin
  perform expire_ownership_requests();
  if not exists (select 1 from households where id = p_household and created_by = auth.uid()) then
    raise exception 'Only the owner can transfer ownership';
  end if;
  if p_to = auth.uid() or not exists (
    select 1 from household_members where household_id = p_household and user_id = p_to and status = 'active'
  ) then
    raise exception 'Pick an active member of this household';
  end if;
  update household_ownership_requests set status = 'cancelled', resolved_at = now()
  where household_id = p_household and kind = 'transfer' and status = 'pending';

  insert into household_ownership_requests (household_id, kind, from_user, to_user, requested_by)
  values (p_household, 'transfer', auth.uid(), p_to, auth.uid()) returning id into v_id;

  select name into v_hh from households where id = p_household;
  select full_name into v_from from profiles where id = auth.uid();
  insert into notifications (user_id, title, message, type, link_path, link_query)
  values (p_to, '👑 Ownership Transfer Request',
    format('%s wants to make you the owner of "%s". Accept or decline within 7 days.', coalesce(v_from, 'The owner'), v_hh),
    'ownership_request', '/settings', 'ownership=' || v_id);
  return v_id;
end;
$$;

create or replace function public.cancel_ownership_request(p_request uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  update household_ownership_requests
  set status = 'cancelled', resolved_at = now()
  where id = p_request and status = 'pending'
    and (requested_by = auth.uid() or (kind = 'claim' and from_user = auth.uid()));
  if not found then raise exception 'Request not found'; end if;
end;
$$;

create or replace function public.respond_ownership_request(p_request uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  r household_ownership_requests;
  v_name text;
begin
  perform expire_ownership_requests();
  select * into r from household_ownership_requests where id = p_request;
  if r.id is null or r.kind <> 'transfer' or r.to_user <> auth.uid() then raise exception 'Request not found'; end if;
  if r.status <> 'pending' then raise exception 'This request is no longer pending (%)', r.status; end if;
  if not exists (select 1 from households where id = r.household_id and created_by = r.from_user) then
    update household_ownership_requests set status = 'cancelled', resolved_at = now() where id = r.id;
    raise exception 'The household owner changed — this request was cancelled';
  end if;

  select full_name into v_name from profiles where id = auth.uid();
  if p_accept then
    perform apply_ownership_change(r.id);
  else
    update household_ownership_requests set status = 'declined', resolved_at = now() where id = r.id;
    -- tap → Settings opens that household and pulses it (see HouseholdsSection)
    insert into notifications (user_id, title, message, type, link_path, link_query)
    values (r.from_user, 'Ownership transfer declined', format('%s declined becoming the owner.', coalesce(v_name, 'The member')), 'ownership_request', '/settings', 'ownership=' || r.id);
  end if;
end;
$$;

-- Members start a claim when the owner has been inactive 30+ days; it passes
-- with approvals from more than half of the remaining (non-owner) members.
create or replace function public.request_ownership_claim(p_household uuid)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_owner uuid;
  v_seen timestamptz;
  v_id uuid;
  v_name text;
  v_hh text;
begin
  perform expire_ownership_requests();
  select h.created_by, p.last_active_at, h.name into v_owner, v_seen, v_hh
  from households h left join profiles p on p.id = h.created_by where h.id = p_household;
  if auth.uid() = v_owner or not exists (
    select 1 from household_members where household_id = p_household and user_id = auth.uid() and status = 'active'
  ) then
    raise exception 'Only members can request ownership';
  end if;
  if v_seen is not null and v_seen > now() - interval '30 days' then
    raise exception 'The owner was active in the last 30 days';
  end if;
  if exists (select 1 from household_ownership_requests where household_id = p_household and kind = 'claim' and status = 'pending') then
    raise exception 'An ownership request is already open for this household';
  end if;

  insert into household_ownership_requests (household_id, kind, from_user, to_user, requested_by)
  values (p_household, 'claim', v_owner, auth.uid(), auth.uid()) returning id into v_id;
  insert into household_ownership_votes (request_id, voter_id, approve) values (v_id, auth.uid(), true);

  select full_name into v_name from profiles where id = auth.uid();
  perform notify_household(p_household, auth.uid(), '🗳️ Ownership Vote',
    format('The owner of "%s" has been inactive for 30+ days. %s asked to become the owner — vote in Settings.', v_hh, coalesce(v_name, 'A member')),
    'ownership_vote', 'ownership=' || v_id);
  perform public.vote_ownership_claim_tally(v_id);
  return v_id;
end;
$$;

create or replace function public.vote_ownership_claim_tally(p_request uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  r household_ownership_requests;
  v_voters integer;
  v_yes integer;
  v_no integer;
begin
  select * into r from household_ownership_requests where id = p_request;
  select count(*) into v_voters from household_members
  where household_id = r.household_id and status = 'active' and user_id <> r.from_user;
  select count(*) filter (where approve), count(*) filter (where not approve) into v_yes, v_no
  from household_ownership_votes v
  join household_members hm on hm.household_id = r.household_id and hm.user_id = v.voter_id and hm.status = 'active'
  where v.request_id = p_request;
  if v_yes * 2 > v_voters then
    perform apply_ownership_change(p_request);
  elsif v_no * 2 >= v_voters then
    update household_ownership_requests set status = 'declined', resolved_at = now() where id = p_request;
    insert into notifications (user_id, title, message, type, link_path, link_query)
    values (r.to_user, 'Ownership request not approved', 'Most members voted against your ownership request.', 'ownership_vote', '/settings', 'ownership=' || p_request);
  end if;
end;
$$;
revoke all on function public.vote_ownership_claim_tally(uuid) from public, anon, authenticated;

create or replace function public.vote_ownership_claim(p_request uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  r household_ownership_requests;
begin
  perform expire_ownership_requests();
  select * into r from household_ownership_requests where id = p_request;
  if r.id is null or r.kind <> 'claim' then raise exception 'Request not found'; end if;
  if r.status <> 'pending' then raise exception 'This request is no longer pending (%)', r.status; end if;
  if auth.uid() = r.from_user or not exists (
    select 1 from household_members where household_id = r.household_id and user_id = auth.uid() and status = 'active'
  ) then
    raise exception 'Only members can vote';
  end if;
  insert into household_ownership_votes (request_id, voter_id, approve) values (p_request, auth.uid(), p_approve)
  on conflict (request_id, voter_id) do update set approve = excluded.approve, created_at = now();
  perform vote_ownership_claim_tally(p_request);
end;
$$;

create or replace function public.leave_household(p_household uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  me household_members;
  v_name text;
  v_hh text;
begin
  select * into me from household_members where household_id = p_household and user_id = auth.uid() and status = 'active';
  if me.id is null then raise exception 'You are not a member of this household'; end if;
  if me.role = 'owner' then
    if exists (select 1 from household_members where household_id = p_household and status = 'active' and user_id <> auth.uid()) then
      raise exception 'Transfer ownership before leaving';
    end if;
    raise exception 'You are the only member — delete the household instead';
  end if;
  if jsonb_array_length(household_leave_blockers(p_household, auth.uid())) > 0 then
    raise exception 'Settle your unpaid shares and pending reviews before leaving';
  end if;

  perform set_config('homesync.membership_rpc', 'on', true);
  update household_members set status = 'left' where id = me.id;
  update household_ownership_requests set status = 'cancelled', resolved_at = now()
  where household_id = p_household and status = 'pending' and (to_user = auth.uid() or requested_by = auth.uid());
  update profiles set household_id = null where id = auth.uid() and household_id = p_household;

  select full_name into v_name from profiles where id = auth.uid();
  select name into v_hh from households where id = p_household;
  perform notify_household(p_household, auth.uid(), '🚪 Member Left',
    format('%s left "%s". Their past expenses and payments stay in the household.', coalesce(v_name, 'A member'), v_hh),
    'member_left');
end;
$$;

create or replace function public.remove_household_member(p_household uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_hh text;
  v_name text;
begin
  if not exists (select 1 from households where id = p_household and created_by = auth.uid()) then
    raise exception 'Only the owner can remove members';
  end if;
  if p_user = auth.uid() then raise exception 'Transfer ownership instead of removing yourself'; end if;
  if not exists (select 1 from household_members where household_id = p_household and user_id = p_user and status = 'active') then
    raise exception 'Not an active member';
  end if;
  if jsonb_array_length(household_leave_blockers(p_household, p_user)) > 0 then
    raise exception 'This member still has unpaid shares or pending reviews';
  end if;

  perform set_config('homesync.membership_rpc', 'on', true);
  update household_members set status = 'kicked' where household_id = p_household and user_id = p_user and status = 'active';
  update household_ownership_requests set status = 'cancelled', resolved_at = now()
  where household_id = p_household and status = 'pending' and (to_user = p_user or requested_by = p_user);
  update profiles set household_id = null where id = p_user and household_id = p_household;

  select name into v_hh from households where id = p_household;
  select full_name into v_name from profiles where id = p_user;
  insert into notifications (user_id, title, message, type)
  values (p_user, 'Removed from Household', format('You have been removed from "%s".', v_hh), 'kicked');
  perform notify_household(p_household, auth.uid(), '🚪 Member Removed',
    format('%s is no longer in "%s". Their past expenses and payments stay in the household.', coalesce(v_name, 'A member'), v_hh),
    'member_left');
end;
$$;

create or replace function public.delete_household(p_household uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not exists (select 1 from households where id = p_household and created_by = auth.uid()) then
    raise exception 'Only the owner can delete the household';
  end if;
  if exists (select 1 from household_members where household_id = p_household and status = 'active' and user_id <> auth.uid()) then
    raise exception 'Other members are still in this household';
  end if;
  perform set_config('homesync.membership_rpc', 'on', true);
  update profiles set household_id = null where household_id = p_household;
  delete from expenses where household_id = p_household;
  delete from utilities where household_id = p_household;
  delete from report_activity where household_id = p_household;
  delete from household_members where household_id = p_household;
  delete from households where id = p_household;
end;
$$;

-- Former members' names / avatars (never payment details): people who used to be
-- in a household I'm still active in, so old expenses keep showing who paid.
create or replace function public.former_member_names(p_user_ids uuid[])
returns table (user_id uuid, full_name text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct p.id, p.full_name, p.avatar_url
  from public.household_members former
  join public.profiles p on p.id = former.user_id
  where former.user_id = any (p_user_ids)
    and former.status in ('left', 'kicked', 'inactive')
    and public.is_active_household_member(former.household_id);
$$;

-- Settings: every household I'm in, with my role, owner activity and open requests
create or replace function public.my_households_overview()
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_out jsonb;
begin
  perform expire_ownership_requests();
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', h.id, 'name', h.name, 'code', h.code, 'owner_id', h.created_by,
           'owner_name', op.full_name,
           'role', case when h.created_by = auth.uid() then 'owner' else 'member' end,
           'owner_inactive', op.last_active_at is not null and op.last_active_at < now() - interval '30 days',
           'members', (
             select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'full_name', mp.full_name, 'avatar_url', mp.avatar_url,
                                                          'role', case when m.user_id = h.created_by then 'owner' else 'member' end)
                                       order by (m.user_id = h.created_by) desc, mp.full_name), '[]'::jsonb)
             from household_members m left join profiles mp on mp.id = m.user_id
             where m.household_id = h.id and m.status = 'active'
           ),
           'requests', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'id', r.id, 'kind', r.kind, 'from_user', r.from_user, 'to_user', r.to_user,
                      'to_name', tp.full_name, 'requested_by', r.requested_by, 'expires_at', r.expires_at,
                      'my_vote', (select v.approve from household_ownership_votes v where v.request_id = r.id and v.voter_id = auth.uid()),
                      'yes', (select count(*) from household_ownership_votes v where v.request_id = r.id and v.approve),
                      'voters', (select count(*) from household_members x where x.household_id = h.id and x.status = 'active' and x.user_id <> r.from_user)
                    )), '[]'::jsonb)
             from household_ownership_requests r left join profiles tp on tp.id = r.to_user
             where r.household_id = h.id and r.status = 'pending'
           )
         ) order by h.name), '[]'::jsonb)
    into v_out
  from household_members me
  join households h on h.id = me.household_id
  left join profiles op on op.id = h.created_by
  where me.user_id = auth.uid() and me.status = 'active';
  return v_out;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'request_ownership_transfer(uuid, uuid)', 'cancel_ownership_request(uuid)', 'respond_ownership_request(uuid, boolean)',
    'request_ownership_claim(uuid)', 'vote_ownership_claim(uuid, boolean)', 'leave_household(uuid)',
    'remove_household_member(uuid, uuid)', 'delete_household(uuid)', 'former_member_names(uuid[])', 'my_households_overview()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ── Former owner's "overpayments" are not refunds anyone owes ──
-- While someone owns a household their own share can end up "paid" above the
-- share (e.g. after lowering an expense) — that's only their own money, and an
-- owner never refunds themselves. Once they hand over ownership, the new owner
-- would suddenly see "Refund to <old owner>". On transfer we cap the old owner's
-- paid_amount at their share for every expense from before the transfer, so no
-- screen (Expenses, Groups, Reports, badges, scheduled reports) lists it.

-- Split guard: same rules as before, plus the membership RPC flag
create or replace function public.guard_expense_split_update_for_rls()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null or pg_trigger_depth() > 1 or public.membership_rpc_on() then
    return new;
  end if;

  if public.is_expense_admin(old.expense_id) then
    if (to_jsonb(new) - array[
      'status', 'proof_id', 'rejection_reason', 'updated_at', 'paid_amount'
    ]) <> (to_jsonb(old) - array[
      'status', 'proof_id', 'rejection_reason', 'updated_at', 'paid_amount'
    ]) then
      raise exception 'Only expense triggers may change split membership or shares';
    end if;

    if new.paid_amount is distinct from old.paid_amount
       and not (
         new.status = 'approved'
         and new.paid_amount = greatest(old.paid_amount, new.share_amount)
       ) then
      raise exception 'Paid amount can only change when approving a split';
    end if;
    return new;
  end if;

  if old.user_id = auth.uid()
     and new.status = 'pending_verification'
     and (to_jsonb(new) - array[
       'status', 'proof_id', 'rejection_reason', 'updated_at'
     ]) = (to_jsonb(old) - array[
       'status', 'proof_id', 'rejection_reason', 'updated_at'
     ])
     and exists (
       select 1
       from public.payment_proofs pp
       where pp.id = new.proof_id
         and pp.expense_id = old.expense_id
         and pp.submitted_by = auth.uid()
         and pp.status = 'pending_verification'
     ) then
    return new;
  end if;

  raise exception 'You are not allowed to change this payment split';
end;
$$;

-- What the former owner paid on an expense from their own time as owner went
-- to themselves, so it is never refunded: paid_as_owner lets the new owner
-- delete those expenses without a refund (and the export lists it).
alter table public.expense_splits add column if not exists paid_as_owner boolean not null default false;

create or replace function public.settle_former_owner_overpayments(p_household uuid, p_user uuid, p_before timestamptz)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  perform set_config('homesync.membership_rpc', 'on', true);
  update expense_splits s
  set paid_amount = s.share_amount, updated_at = now()
  from expenses e
  where e.id = s.expense_id
    and e.household_id = p_household
    and e.created_at < p_before
    and s.user_id = p_user
    and s.status = 'approved'
    and coalesce(s.paid_amount, 0) > s.share_amount;

  update expense_splits s
  set paid_as_owner = true, updated_at = now()
  from expenses e
  where e.id = s.expense_id
    and e.household_id = p_household
    and e.created_at < p_before
    and s.user_id = p_user
    and coalesce(s.paid_amount, 0) > 0
    and not s.paid_as_owner;
end;
$$;
revoke all on function public.settle_former_owner_overpayments(uuid, uuid, timestamptz) from public, anon, authenticated;

-- run it on every ownership change from now on
create or replace function public.settle_on_owner_change()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if new.created_by is distinct from old.created_by and old.created_by is not null then
    perform settle_former_owner_overpayments(new.id, old.created_by, now());
  end if;
  -- The new owner renames directly — their own pending rename requests go away
  if new.created_by is distinct from old.created_by and new.created_by is not null then
    delete from name_change_requests
    where household_id = new.id and requested_by = new.created_by and status = 'pending';
  end if;
  return new;
end;
$$;
revoke all on function public.settle_on_owner_change() from public, anon, authenticated;
drop trigger if exists trg_settle_on_owner_change on public.households;
create trigger trg_settle_on_owner_change
after update of created_by on public.households
for each row execute function public.settle_on_owner_change();

-- households already transferred before this migration
do $$
declare r record;
begin
  for r in
    select household_id, from_user, resolved_at
    from public.household_ownership_requests
    where status = 'accepted' and resolved_at is not null
  loop
    perform public.settle_former_owner_overpayments(r.household_id, r.from_user, r.resolved_at);
  end loop;
end $$;

-- Rename requests left pending by members who are now the owner
delete from public.name_change_requests r
using public.households h
where r.household_id = h.id and r.requested_by = h.created_by and r.status = 'pending';

-- ── Notifications already sent ──
-- "Member Left" is information only — no tap target
update public.notifications set link_path = null, link_query = null
where type = 'member_left' and link_path is not null;
-- older "declined" notices → link them to their request so a tap opens that household
update public.notifications n
set link_query = 'ownership=' || r.id
from public.household_ownership_requests r
where n.link_query is null
  and n.title in ('Ownership transfer declined', 'Ownership request not approved')
  and r.status = 'declined'
  and n.user_id = case when n.title = 'Ownership transfer declined' then r.from_user else r.to_user end
  and abs(extract(epoch from (r.resolved_at - n.created_at))) < 120;

commit;
