-- Replaces existing policies on the listed tables; test in a staging project first.
-- Storage object access (including payment-proofs) is configured separately.
begin;

create or replace function public.is_active_household_member(
  p_household_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = p_user_id
      and hm.status = 'active'
  ) or exists (
    select 1
    from public.households h
    where h.id = p_household_id
      and h.created_by = p_user_id
  );
$$;

create or replace function public.is_active_group_member(
  p_group_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = p_user_id
      and gm.status = 'active'
  ) or exists (
    select 1
    from public.groups g
    where g.id = p_group_id
      and g.created_by = p_user_id
  );
$$;

create or replace function public.is_expense_admin(p_expense_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.expenses e
    left join public.households h on h.id = e.household_id
    left join public.groups g on g.id = e.group_id
    where e.id = p_expense_id
      and (h.created_by = auth.uid() or g.created_by = auth.uid())
  );
$$;

create or replace function public.can_access_expense(p_expense_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.expenses e
    where e.id = p_expense_id
      and (
        e.created_by = auth.uid()
        or e.paid_by = auth.uid()
        or public.is_active_household_member(e.household_id)
        or public.is_active_group_member(e.group_id)
      )
  );
$$;

create or replace function public.can_view_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile_id = auth.uid()
    or exists (
      select 1
      from public.household_members mine
      join public.household_members theirs
        on theirs.household_id = mine.household_id
      where mine.user_id = auth.uid()
        and theirs.user_id = p_profile_id
        and mine.status = 'active'
        and theirs.status = 'active'
    )
    or exists (
      select 1
      from public.group_members mine
      join public.group_members theirs
        on theirs.group_id = mine.group_id
      where mine.user_id = auth.uid()
        and theirs.user_id = p_profile_id
        and mine.status = 'active'
        and theirs.status = 'active'
    )
    or exists (
      select 1
      from public.households h
      join public.household_members theirs on theirs.household_id = h.id
      where h.created_by = auth.uid()
        and theirs.user_id = p_profile_id
        and theirs.status = 'active'
    )
    or exists (
      select 1
      from public.groups g
      join public.group_members theirs on theirs.group_id = g.id
      where g.created_by = auth.uid()
        and theirs.user_id = p_profile_id
        and theirs.status = 'active'
    );
$$;

create or replace function public.can_notify_user(p_recipient_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_recipient_id = auth.uid()
    or exists (
      select 1
      from public.household_members mine
      join public.household_members theirs
        on theirs.household_id = mine.household_id
      where mine.user_id = auth.uid()
        and theirs.user_id = p_recipient_id
    )
    or exists (
      select 1
      from public.group_members mine
      join public.group_members theirs
        on theirs.group_id = mine.group_id
      where mine.user_id = auth.uid()
        and theirs.user_id = p_recipient_id
    )
    or exists (
      select 1
      from public.households h
      join public.household_members hm on hm.household_id = h.id
      where h.created_by = auth.uid()
        and hm.user_id = p_recipient_id
    )
    or exists (
      select 1
      from public.groups g
      join public.group_members gm on gm.group_id = g.id
      where g.created_by = auth.uid()
        and gm.user_id = p_recipient_id
    );
$$;

create or replace function public.lookup_household_by_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household record;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select h.id, h.name into v_household
  from public.households h
  where upper(h.code) = upper(trim(p_code))
  limit 1;

  if not found then
    return null;
  end if;

  return jsonb_build_object('id', v_household.id, 'name', v_household.name);
end;
$$;

create or replace function public.join_household_by_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household record;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select h.id, h.name into v_household
  from public.households h
  where upper(h.code) = upper(trim(p_code))
  limit 1;

  if not found then
    raise exception 'Invalid household invite code';
  end if;

  if not exists (
    select 1 from public.profiles p where p.id = auth.uid()
  ) then
    raise exception 'Create your profile before joining a household';
  end if;

  insert into public.household_members (household_id, user_id, role, status)
  select v_household.id, auth.uid(), 'member', 'active'
  where not exists (
    select 1
    from public.household_members hm
    where hm.household_id = v_household.id
      and hm.user_id = auth.uid()
      and hm.status = 'active'
  );

  return jsonb_build_object('id', v_household.id, 'name', v_household.name);
end;
$$;

create or replace function public.join_group_by_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group record;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select g.id, g.name into v_group
  from public.groups g
  where upper(g.code) = upper(trim(p_code))
  limit 1;

  if not found then
    raise exception 'Invalid group invite code';
  end if;

  if not exists (
    select 1 from public.profiles p where p.id = auth.uid()
  ) then
    raise exception 'Create your profile before joining a group';
  end if;

  insert into public.group_members (group_id, user_id, role, status)
  select v_group.id, auth.uid(), 'member', 'active'
  where not exists (
    select 1
    from public.group_members gm
    where gm.group_id = v_group.id
      and gm.user_id = auth.uid()
      and gm.status = 'active'
  );

  return jsonb_build_object('id', v_group.id, 'name', v_group.name);
end;
$$;

create or replace function public.guard_expense_update_for_rls()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null or public.is_expense_admin(old.id) then
    return new;
  end if;

  if old.created_by = auth.uid()
     and old.approval_status = 'pending_approval'
     and (to_jsonb(new) - array[
       'title', 'amount', 'category', 'due_date', 'split_type',
       'members_split', 'deleted_at', 'deleted_by'
     ]) = (to_jsonb(old) - array[
       'title', 'amount', 'category', 'due_date', 'split_type',
       'members_split', 'deleted_at', 'deleted_by'
     ]) then
    return new;
  end if;

  if (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status')
     and public.can_access_expense(old.id) then
    if new.status = 'verifying'
       and exists (
         select 1 from public.expense_splits s
         where s.expense_id = old.id
           and s.status = 'pending_verification'
       ) then
      return new;
    end if;
    if new.status = 'pending'
       and not exists (
         select 1 from public.expense_splits s
         where s.expense_id = old.id
           and s.status = 'pending_verification'
       )
       and exists (
         select 1 from public.expense_splits s
         where s.expense_id = old.id
           and s.status <> 'approved'
       ) then
      return new;
    end if;
    if new.status = 'paid'
       and exists (
         select 1 from public.expense_splits s
         where s.expense_id = old.id
       )
       and not exists (
         select 1 from public.expense_splits s
         where s.expense_id = old.id
           and s.status <> 'approved'
       ) then
      return new;
    end if;
  end if;

  raise exception 'You are not allowed to change these expense fields';
end;
$$;

create or replace function public.guard_expense_split_update_for_rls()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then
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

create or replace function public.guard_expense_split_insert_for_rls()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_share numeric;
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.user_id <> auth.uid() or new.status <> 'pending_verification' then
    raise exception 'You can only create your own pending payment split';
  end if;

  select (e.members_split ->> auth.uid()::text)::numeric
  into v_share
  from public.expenses e
  where e.id = new.expense_id
    and (e.members_split ? auth.uid()::text or e.paid_by = auth.uid());

  if not found or v_share is null or new.share_amount <> v_share then
    raise exception 'You are not listed as owing this expense';
  end if;

  if not exists (
    select 1
    from public.payment_proofs pp
    where pp.id = new.proof_id
      and pp.expense_id = new.expense_id
      and pp.submitted_by = auth.uid()
      and pp.status = 'pending_verification'
  ) then
    raise exception 'A matching pending payment proof is required';
  end if;

  return new;
end;
$$;

create or replace function public.guard_payment_proof_insert_for_rls()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.submitted_by <> auth.uid() then
    raise exception 'You can only submit your own payment proof';
  end if;

  if new.expense_id is not null then
    if public.is_expense_admin(new.expense_id) then
      if new.status <> 'verified' then
        raise exception 'Owner-submitted proofs must be verified';
      end if;
      return new;
    end if;

    if new.status <> 'pending_verification'
       or not exists (
         select 1
         from public.expenses e
         where e.id = new.expense_id
           and (e.members_split ? auth.uid()::text or e.paid_by = auth.uid())
       ) then
      raise exception 'You are not eligible to submit proof for this expense';
    end if;
  elsif new.utility_id is not null then
    if new.status <> 'pending_verification'
       or not public.can_access_utility(new.utility_id) then
      raise exception 'You are not eligible to submit proof for this utility';
    end if;
  else
    raise exception 'A proof must reference an expense or utility';
  end if;

  return new;
end;
$$;

create or replace function public.guard_payment_proof_update_for_rls()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if public.is_expense_admin(old.expense_id) then
    if (to_jsonb(new) - array['status', 'rejection_reason'])
       <> (to_jsonb(old) - array['status', 'rejection_reason']) then
      raise exception 'Only proof status and rejection reason may be changed';
    end if;
    return new;
  end if;

  raise exception 'Only the expense owner can review payment proofs';
end;
$$;

create or replace function public.guard_followup_proof_insert_for_rls()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_share numeric;
  v_paid numeric;
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.user_id <> auth.uid()
     or new.status <> 'pending_verification' then
    raise exception 'You can only submit your own pending follow-up proof';
  end if;

  select s.share_amount, s.paid_amount
  into v_share, v_paid
  from public.expense_splits s
  where s.expense_id = new.expense_id
    and s.user_id = auth.uid();

  if not found or new.amount > greatest(v_share - v_paid, 0) then
    raise exception 'Follow-up amount exceeds the outstanding share';
  end if;

  return new;
end;
$$;

create or replace function public.guard_profile_update_for_rls()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.created_at is distinct from old.created_at
     or (new.household_id is not null
         and new.household_id is distinct from old.household_id
         and not public.is_active_household_member(new.household_id)) then
    raise exception 'You are not allowed to change these profile fields';
  end if;
  return new;
end;
$$;

create or replace function public.guard_profile_insert_for_rls()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and (
       new.id <> auth.uid()
       or (
         new.household_id is not null
         and not public.is_active_household_member(new.household_id)
       )
     ) then
    raise exception 'You can only create your own profile for a household you belong to';
  end if;
  return new;
end;
$$;

create or replace function public.guard_membership_update_for_rls()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_table_name = 'household_members' then
    if exists (
      select 1 from public.households h
      where h.id = old.household_id and h.created_by = auth.uid()
    ) then
      return new;
    end if;
  elsif exists (
    select 1 from public.groups g
    where g.id = old.group_id and g.created_by = auth.uid()
  ) then
    return new;
  end if;

  if old.user_id = auth.uid()
     and new.user_id = old.user_id
     and new.role = old.role
     and new.status = 'inactive' then
    return new;
  end if;

  raise exception 'Only the owner can change membership';
end;
$$;

create or replace function public.guard_notification_update_for_rls()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and (to_jsonb(new) - 'is_read') <> (to_jsonb(old) - 'is_read') then
    raise exception 'Only notification read status may be changed';
  end if;
  return new;
end;
$$;

create or replace function public.guard_utility_update_for_rls()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null
     or exists (
       select 1 from public.households h
       where h.id = old.household_id and h.created_by = auth.uid()
     ) then
    return new;
  end if;

  if new.status = 'verifying'
     and (to_jsonb(new) - 'status') = (to_jsonb(old) - 'status')
     and public.is_active_household_member(old.household_id) then
    return new;
  end if;

  raise exception 'Only the household owner can edit this utility';
end;
$$;

create or replace function public.guard_utility_confirmation_update_for_rls()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null or old.user_id = auth.uid() then
    if (to_jsonb(new) - array['status', 'dispute_reason', 'confirmed_at'])
       <> (to_jsonb(old) - array['status', 'dispute_reason', 'confirmed_at']) then
      raise exception 'Only confirmation status may be changed';
    end if;
    return new;
  end if;

  raise exception 'You cannot edit another member confirmation';
end;
$$;

create or replace function public.guard_refund_confirmation_for_rls()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and old.user_id = auth.uid()
     and new.status = 'confirmed' and old.status = 'sent' then
    return new;
  end if;
  if auth.uid() is null or public.is_expense_admin(old.expense_id) then
    return new;
  end if;
  raise exception 'Only the recipient can confirm this refund';
end;
$$;

create or replace function public.can_access_utility(p_utility_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.utilities u
    where u.id = p_utility_id
      and public.is_active_household_member(u.household_id)
  );
$$;

create or replace function public.can_share_household_history(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.households h
    where h.id = p_household_id and h.created_by = auth.uid()
  ) or exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = auth.uid()
      and hm.status = 'active'
  );
$$;

revoke all on function public.is_active_household_member(uuid, uuid) from public;
revoke all on function public.is_active_group_member(uuid, uuid) from public;
revoke all on function public.is_expense_admin(uuid) from public;
revoke all on function public.can_access_expense(uuid) from public;
revoke all on function public.can_view_profile(uuid) from public;
revoke all on function public.can_notify_user(uuid) from public;
revoke all on function public.can_access_utility(uuid) from public;
revoke all on function public.can_share_household_history(uuid) from public;
revoke all on function public.lookup_household_by_code(text) from public;
revoke all on function public.join_household_by_code(text) from public;
revoke all on function public.join_group_by_code(text) from public;
revoke all on function public.guard_expense_update_for_rls() from public;
revoke all on function public.guard_expense_split_update_for_rls() from public;
revoke all on function public.guard_expense_split_insert_for_rls() from public;
revoke all on function public.guard_payment_proof_insert_for_rls() from public;
revoke all on function public.guard_payment_proof_update_for_rls() from public;
revoke all on function public.guard_followup_proof_insert_for_rls() from public;
revoke all on function public.guard_profile_update_for_rls() from public;
revoke all on function public.guard_profile_insert_for_rls() from public;
revoke all on function public.guard_membership_update_for_rls() from public;
revoke all on function public.guard_notification_update_for_rls() from public;
revoke all on function public.guard_utility_update_for_rls() from public;
revoke all on function public.guard_utility_confirmation_update_for_rls() from public;
revoke all on function public.guard_refund_confirmation_for_rls() from public;
grant execute on function public.is_active_household_member(uuid, uuid) to authenticated;
grant execute on function public.is_active_group_member(uuid, uuid) to authenticated;
grant execute on function public.is_expense_admin(uuid) to authenticated;
grant execute on function public.can_access_expense(uuid) to authenticated;
grant execute on function public.can_view_profile(uuid) to authenticated;
grant execute on function public.can_notify_user(uuid) to authenticated;
grant execute on function public.can_access_utility(uuid) to authenticated;
grant execute on function public.can_share_household_history(uuid) to authenticated;
grant execute on function public.lookup_household_by_code(text) to authenticated;
grant execute on function public.join_household_by_code(text) to authenticated;
grant execute on function public.join_group_by_code(text) to authenticated;

drop trigger if exists trg_zz_guard_expense_update_for_rls on public.expenses;
create trigger trg_zz_guard_expense_update_for_rls
before update on public.expenses
for each row execute function public.guard_expense_update_for_rls();

drop trigger if exists trg_zz_guard_expense_split_update_for_rls on public.expense_splits;
create trigger trg_zz_guard_expense_split_update_for_rls
before update on public.expense_splits
for each row execute function public.guard_expense_split_update_for_rls();

drop trigger if exists trg_guard_expense_split_insert_for_rls on public.expense_splits;
create trigger trg_guard_expense_split_insert_for_rls
before insert on public.expense_splits
for each row execute function public.guard_expense_split_insert_for_rls();

drop trigger if exists trg_guard_payment_proof_insert_for_rls on public.payment_proofs;
create trigger trg_guard_payment_proof_insert_for_rls
before insert on public.payment_proofs
for each row execute function public.guard_payment_proof_insert_for_rls();

drop trigger if exists trg_zz_guard_payment_proof_update_for_rls on public.payment_proofs;
create trigger trg_zz_guard_payment_proof_update_for_rls
before update on public.payment_proofs
for each row execute function public.guard_payment_proof_update_for_rls();

drop trigger if exists trg_guard_followup_proof_insert_for_rls on public.expense_followup_proofs;
create trigger trg_guard_followup_proof_insert_for_rls
before insert on public.expense_followup_proofs
for each row execute function public.guard_followup_proof_insert_for_rls();

drop trigger if exists trg_guard_profile_update_for_rls on public.profiles;
create trigger trg_guard_profile_update_for_rls
before update on public.profiles
for each row execute function public.guard_profile_update_for_rls();

drop trigger if exists trg_guard_profile_insert_for_rls on public.profiles;
create trigger trg_guard_profile_insert_for_rls
before insert on public.profiles
for each row execute function public.guard_profile_insert_for_rls();

drop trigger if exists trg_guard_household_members_update_for_rls on public.household_members;
create trigger trg_guard_household_members_update_for_rls
before update on public.household_members
for each row execute function public.guard_membership_update_for_rls();

drop trigger if exists trg_guard_group_members_update_for_rls on public.group_members;
create trigger trg_guard_group_members_update_for_rls
before update on public.group_members
for each row execute function public.guard_membership_update_for_rls();

drop trigger if exists trg_guard_notification_update_for_rls on public.notifications;
create trigger trg_guard_notification_update_for_rls
before update on public.notifications
for each row execute function public.guard_notification_update_for_rls();

drop trigger if exists trg_guard_utility_update_for_rls on public.utilities;
create trigger trg_guard_utility_update_for_rls
before update on public.utilities
for each row execute function public.guard_utility_update_for_rls();

drop trigger if exists trg_guard_utility_confirmation_update_for_rls on public.utility_confirmations;
create trigger trg_guard_utility_confirmation_update_for_rls
before update on public.utility_confirmations
for each row execute function public.guard_utility_confirmation_update_for_rls();

drop trigger if exists trg_guard_refund_confirmation_for_rls on public.expense_refunds;
create trigger trg_guard_refund_confirmation_for_rls
before update on public.expense_refunds
for each row execute function public.guard_refund_confirmation_for_rls();

do $$
declare
  t text;
  p record;
begin
  foreach t in array array[
    'households', 'household_members', 'groups', 'group_members',
    'expenses', 'expense_splits', 'payment_proofs', 'utilities',
    'utility_confirmations', 'profiles', 'notifications',
    'expense_followup_proofs', 'expense_refunds', 'generated_reports',
    'report_activity'
  ] loop
    for p in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
  end loop;
end;
$$;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_splits enable row level security;
alter table public.payment_proofs enable row level security;
alter table public.utilities enable row level security;
alter table public.utility_confirmations enable row level security;
alter table public.profiles enable row level security;
alter table public.notifications enable row level security;
alter table public.expense_followup_proofs enable row level security;
alter table public.expense_refunds enable row level security;
alter table public.generated_reports enable row level security;
alter table public.report_activity enable row level security;

create policy households_read_members
on public.households for select to authenticated
using (created_by = auth.uid() or public.is_active_household_member(id));
create policy households_create_self
on public.households for insert to authenticated
with check (created_by = auth.uid());
create policy households_update_owner
on public.households for update to authenticated
using (created_by = auth.uid())
with check (
  created_by = auth.uid()
  or public.is_active_household_member(id, created_by)
);
create policy households_delete_owner
on public.households for delete to authenticated
using (created_by = auth.uid());

create policy household_members_read
on public.household_members for select to authenticated
using (
  user_id = auth.uid()
  or public.is_active_household_member(household_id)
);
create policy household_members_create_owner
on public.household_members for insert to authenticated
with check (
  user_id = auth.uid()
  and role = 'owner'
  and exists (
    select 1 from public.households h
    where h.id = household_id and h.created_by = auth.uid()
  )
);
create policy household_members_update_owner_or_leave
on public.household_members for update to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.households h
    where h.id = household_id and h.created_by = auth.uid()
  )
)
with check (
  user_id = auth.uid()
  or exists (
    select 1 from public.households h
    where h.id = household_id and h.created_by = auth.uid()
  )
);
create policy household_members_delete_owner_or_self
on public.household_members for delete to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.households h
    where h.id = household_id and h.created_by = auth.uid()
  )
);

create policy groups_read_members
on public.groups for select to authenticated
using (created_by = auth.uid() or public.is_active_group_member(id));
create policy groups_create_self
on public.groups for insert to authenticated
with check (created_by = auth.uid());
create policy groups_update_owner
on public.groups for update to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());
create policy groups_delete_owner
on public.groups for delete to authenticated
using (created_by = auth.uid());

create policy group_members_read
on public.group_members for select to authenticated
using (
  user_id = auth.uid()
  or public.is_active_group_member(group_id)
);
create policy group_members_create_owner
on public.group_members for insert to authenticated
with check (
  user_id = auth.uid()
  and role = 'owner'
  and exists (
    select 1 from public.groups g
    where g.id = group_id and g.created_by = auth.uid()
  )
);
create policy group_members_update_owner_or_leave
on public.group_members for update to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.groups g
    where g.id = group_id and g.created_by = auth.uid()
  )
)
with check (
  user_id = auth.uid()
  or exists (
    select 1 from public.groups g
    where g.id = group_id and g.created_by = auth.uid()
  )
);
create policy group_members_delete_owner_or_self
on public.group_members for delete to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.groups g
    where g.id = group_id and g.created_by = auth.uid()
  )
);

create policy profiles_read_self_or_shared_members
on public.profiles for select to authenticated
using (public.can_view_profile(id));
create policy profiles_insert_self
on public.profiles for insert to authenticated
with check (id = auth.uid());
create policy profiles_update_self
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy expenses_read_context_members
on public.expenses for select to authenticated
using (public.can_access_expense(id));
create policy expenses_insert_context_members
on public.expenses for insert to authenticated
with check (
  created_by = auth.uid()
  and (
    public.is_active_household_member(household_id)
    or public.is_active_group_member(group_id)
  )
);
create policy expenses_update_context
on public.expenses for update to authenticated
using (
  public.is_expense_admin(id)
  or (created_by = auth.uid() and approval_status = 'pending_approval')
  or public.can_access_expense(id)
)
with check (
  public.is_expense_admin(id)
  or (created_by = auth.uid() and approval_status = 'pending_approval')
  or public.can_access_expense(id)
);
create policy expenses_delete_owner
on public.expenses for delete to authenticated
using (public.is_expense_admin(id));

create policy expense_splits_read_context
on public.expense_splits for select to authenticated
using (public.can_access_expense(expense_id));
create policy expense_splits_insert_self
on public.expense_splits for insert to authenticated
with check (
  user_id = auth.uid()
  and public.can_access_expense(expense_id)
);
create policy expense_splits_update_self_or_admin
on public.expense_splits for update to authenticated
using (user_id = auth.uid() or public.is_expense_admin(expense_id))
with check (user_id = auth.uid() or public.is_expense_admin(expense_id));
create policy expense_splits_delete_admin
on public.expense_splits for delete to authenticated
using (public.is_expense_admin(expense_id));

create policy payment_proofs_read_context
on public.payment_proofs for select to authenticated
using (
  submitted_by = auth.uid()
  or (expense_id is not null and public.can_access_expense(expense_id))
  or (utility_id is not null and public.can_access_utility(utility_id))
);
create policy payment_proofs_insert_own
on public.payment_proofs for insert to authenticated
with check (
  submitted_by = auth.uid()
  and (
    (expense_id is not null and public.can_access_expense(expense_id))
    or (utility_id is not null and public.can_access_utility(utility_id))
  )
);
create policy payment_proofs_update_admin
on public.payment_proofs for update to authenticated
using (expense_id is not null and public.is_expense_admin(expense_id))
with check (expense_id is not null and public.is_expense_admin(expense_id));
create policy payment_proofs_delete_rejected_own
on public.payment_proofs for delete to authenticated
using (submitted_by = auth.uid() and status = 'rejected');

create policy utilities_read_members
on public.utilities for select to authenticated
using (public.is_active_household_member(household_id));
create policy utilities_insert_members
on public.utilities for insert to authenticated
with check (
  created_by = auth.uid()
  and public.is_active_household_member(household_id)
);
create policy utilities_update_members
on public.utilities for update to authenticated
using (public.is_active_household_member(household_id))
with check (public.is_active_household_member(household_id));
create policy utilities_delete_owner
on public.utilities for delete to authenticated
using (
  exists (
    select 1 from public.households h
    where h.id = household_id and h.created_by = auth.uid()
  )
);

create policy utility_confirmations_read_members
on public.utility_confirmations for select to authenticated
using (public.can_access_utility(utility_id));
create policy utility_confirmations_insert_own
on public.utility_confirmations for insert to authenticated
with check (user_id = auth.uid() and public.can_access_utility(utility_id));
create policy utility_confirmations_update_own
on public.utility_confirmations for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy notifications_read_own
on public.notifications for select to authenticated
using (user_id = auth.uid());
create policy notifications_insert_shared_context
on public.notifications for insert to authenticated
with check (user_id is not null and public.can_notify_user(user_id));
create policy notifications_update_own
on public.notifications for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
create policy notifications_delete_own
on public.notifications for delete to authenticated
using (user_id = auth.uid());

create policy expense_followup_proofs_read
on public.expense_followup_proofs for select to authenticated
using (
  user_id = auth.uid()
  or public.is_expense_admin(expense_id)
);
create policy expense_followup_proofs_insert_own
on public.expense_followup_proofs for insert to authenticated
with check (
  user_id = auth.uid()
  and public.can_access_expense(expense_id)
  and exists (
    select 1 from public.expense_splits s
    where s.expense_id = expense_followup_proofs.expense_id
      and s.user_id = auth.uid()
  )
);
create policy expense_followup_proofs_update_admin
on public.expense_followup_proofs for update to authenticated
using (public.is_expense_admin(expense_id))
with check (public.is_expense_admin(expense_id));

create policy expense_refunds_read
on public.expense_refunds for select to authenticated
using (user_id = auth.uid() or public.is_expense_admin(expense_id));
create policy expense_refunds_insert_admin
on public.expense_refunds for insert to authenticated
with check (public.is_expense_admin(expense_id));
create policy expense_refunds_update_recipient
on public.expense_refunds for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy generated_reports_read_household
on public.generated_reports for select to authenticated
using (
  generated_by = auth.uid()
  or public.is_active_household_member(household_id)
);
create policy generated_reports_insert_household
on public.generated_reports for insert to authenticated
with check (
  generated_by = auth.uid()
  and public.is_active_household_member(household_id)
);
create policy generated_reports_delete_own
on public.generated_reports for delete to authenticated
using (generated_by = auth.uid());

create policy report_activity_read_household
on public.report_activity for select to authenticated
using (public.can_share_household_history(household_id));
create policy report_activity_insert_member
on public.report_activity for insert to authenticated
with check (
  user_id = auth.uid()
  and public.is_active_household_member(household_id)
);

commit;
