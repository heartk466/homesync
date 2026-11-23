-- Expense category rules
--   • category is a label only (nothing here touches amount / splits / proofs)
--   • category locks once a member (other than the admin editing it) paid or
--     sent a proof, or when the expense
--     is linked to a utility provider / subscription
--   • Electricity / Water: one expense per household (or group) per billing month
--   • expense_history: category changes, deletions and recreations (actor +
--     before/after) — read by "Export My Data"; everyone in the household /
--     group is notified of each one

begin;

-- ── Billing period (first day of the billed month) ──
alter table public.expenses add column if not exists billing_period date;

update public.expenses
set billing_period = date_trunc('month', expense_date)::date
where category in ('Electricity', 'Water') and billing_period is null;

-- ── History ──
create table if not exists public.expense_history (
  id                 uuid primary key default gen_random_uuid(),
  expense_id         uuid not null references public.expenses(id) on delete cascade,
  household_id       uuid,
  group_id           uuid,
  actor_id           uuid,
  action             text not null check (action in ('category_changed', 'deleted', 'recreated')),
  before             jsonb,
  after              jsonb,
  related_expense_id uuid,
  created_at         timestamptz not null default now()
);
create index if not exists expense_history_household_idx on public.expense_history (household_id, created_at);
create index if not exists expense_history_group_idx on public.expense_history (group_id, created_at);

alter table public.expense_history enable row level security;
drop policy if exists expense_history_read_context on public.expense_history;
create policy expense_history_read_context
on public.expense_history for select to authenticated
using (public.is_active_household_member(household_id) or public.is_active_group_member(group_id));
-- No insert/update/delete policies: rows are written only by the trigger below.

-- ── BEFORE: billing month + category lock + one-per-month ──
create or replace function public.guard_expense_category()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_billing boolean := new.category in ('Electricity', 'Water');
begin
  -- Normalise only when something billing-related changed, so status-only
  -- updates by members leave the row untouched.
  if tg_op = 'INSERT'
     or new.category is distinct from old.category
     or new.billing_period is distinct from old.billing_period then
    new.billing_period := case
      when v_billing then date_trunc('month', coalesce(new.billing_period, new.expense_date, current_date))::date
      else null                                  -- moving away frees the month
    end;
  end if;

  if tg_op = 'UPDATE' and new.category is distinct from old.category and auth.uid() is not null then
    if old.utility_id is not null or coalesce(old.source, 'expenses') <> 'expenses' then
      raise exception 'Category is locked because this expense is linked to a utility provider or subscription.';
    end if;
    if exists (
      select 1 from public.expense_splits s
      where s.expense_id = old.id
        and s.user_id is distinct from auth.uid()       -- the admin's own payment doesn't lock it
        and (s.status <> 'unpaid' or coalesce(s.paid_amount, 0) > 0)
    ) then
      raise exception 'Category is locked because payments exist. Delete and recreate the expense to fix it.';
    end if;
  end if;

  if v_billing and new.deleted_at is null and (
       tg_op = 'INSERT'
       or new.category is distinct from old.category
       or new.billing_period is distinct from old.billing_period
       or old.deleted_at is not null
     ) and exists (
       select 1 from public.expenses e
       where e.id <> new.id
         and e.deleted_at is null
         and e.category = new.category
         and e.billing_period = new.billing_period
         and e.household_id is not distinct from new.household_id
         and e.group_id is not distinct from new.group_id
     ) then
    raise exception '% already exists for %. Edit that expense instead.',
      new.category, to_char(new.billing_period, 'FMMonth');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_expense_category on public.expenses;
create trigger trg_guard_expense_category
before insert or update on public.expenses
for each row execute function public.guard_expense_category();

-- ── AFTER: history + notify everyone in the household / group ──
create or replace function public.log_expense_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := auth.uid();
  v_name   text;
  v_old    public.expenses;
  v_action text;
  v_before jsonb;
  v_after  jsonb;
  v_title  text;
  v_msg    text;
  v_amount text := '₱' || to_char(new.amount, 'FM999,999,990.00');
begin
  if tg_op = 'UPDATE' and new.deleted_at is null and new.category is distinct from old.category then
    v_action := 'category_changed';
    v_before := jsonb_build_object('title', old.title, 'category', old.category, 'amount', old.amount);
    v_after  := jsonb_build_object('title', new.title, 'category', new.category, 'amount', new.amount);
  elsif tg_op = 'UPDATE' and new.deleted_at is not null and old.deleted_at is null
        and coalesce(new.approval_status, '') <> 'rejected' then  -- rejected proposals notify on their own
    v_action := 'deleted';
    v_actor  := coalesce(v_actor, new.deleted_by);
    v_before := jsonb_build_object('title', old.title, 'category', old.category, 'amount', old.amount);
  elsif tg_op = 'INSERT' then
    -- Recreated = same title as an expense deleted in this household/group
    -- within the last 30 days (that hasn't been recreated yet).
    select e.* into v_old
    from public.expenses e
    where e.id <> new.id
      and e.deleted_at is not null
      and e.deleted_at > now() - interval '30 days'
      and coalesce(e.approval_status, '') <> 'rejected'
      and lower(trim(e.title)) = lower(trim(new.title))
      and e.household_id is not distinct from new.household_id
      and e.group_id is not distinct from new.group_id
      and not exists (
        select 1 from public.expense_history x
        where x.action = 'recreated' and x.related_expense_id = e.id
      )
    order by e.deleted_at desc
    limit 1;
    if v_old.id is null then return new; end if;
    v_action := 'recreated';
    v_actor  := coalesce(v_actor, new.created_by);
    v_before := jsonb_build_object('title', v_old.title, 'category', v_old.category, 'amount', v_old.amount);
    v_after  := jsonb_build_object('title', new.title, 'category', new.category, 'amount', new.amount);
  else
    return new;
  end if;

  insert into public.expense_history (expense_id, household_id, group_id, actor_id, action, before, after, related_expense_id)
  values (new.id, new.household_id, new.group_id, v_actor, v_action, v_before, v_after, v_old.id);

  select coalesce(p.full_name, 'Someone') into v_name from public.profiles p where p.id = v_actor;
  v_name := coalesce(v_name, 'Someone');

  if v_action = 'category_changed' then
    v_title := '🏷️ Expense Category Changed';
    v_msg := format('%s changed the category of "%s": %s → %s.', v_name, new.title, old.category, new.category);
  elsif v_action = 'deleted' then
    v_title := '🗑️ Expense Deleted';
    v_msg := format('%s deleted "%s" (%s, %s).', v_name, old.title, v_amount, old.category);
  else
    v_title := '♻️ Expense Recreated';
    v_msg := format('%s recreated "%s" (%s, %s). It replaces the deleted one.', v_name, new.title, v_amount, new.category);
  end if;

  insert into public.notifications (user_id, title, message, type, link_path, link_state, link_query)
  select r.uid, v_title, v_msg, 'expense_' || v_action,
         case when new.household_id is not null then '/expenses' else '/groups/' || new.group_id || '?type=group' end,
         case when new.household_id is not null then null else '{"type":"group"}' end,
         case when new.household_id is not null
              then 'householdId=' || new.household_id || '&expenseId=' || new.id
              else 'expenseId=' || new.id end
  from (
    select hm.user_id as uid from public.household_members hm where hm.household_id = new.household_id and hm.status = 'active'
    union select h.created_by from public.households h where h.id = new.household_id
    union select gm.user_id from public.group_members gm where gm.group_id = new.group_id and gm.status = 'active'
    union select g.created_by from public.groups g where g.id = new.group_id
  ) r
  where r.uid is not null and r.uid is distinct from v_actor;

  return new;
end;
$$;

revoke all on function public.log_expense_history() from public, anon, authenticated;

drop trigger if exists trg_log_expense_history on public.expenses;
create trigger trg_log_expense_history
after insert or update of category, deleted_at on public.expenses
for each row execute function public.log_expense_history();

commit;
