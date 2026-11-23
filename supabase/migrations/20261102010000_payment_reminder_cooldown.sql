-- "Remind" on an unpaid share: at most once every 24 hours per member per
-- expense, enforced here (not only by the button), and kept across refreshes
-- and devices.
--
--   payment_reminder_log         last manual reminder per (expense, member)
--   send_payment_reminder(e, u)  owner only; checks the cooldown, adds the
--                                "Payment Reminder" notification (the push
--                                trigger sends it to the member's phone) and
--                                returns when the next reminder is allowed.
--                                Raises REMIND_COOLDOWN|<next allowed time> if
--                                it's too soon.
-- Safe to run more than once.

create table if not exists public.payment_reminder_log (
  expense_id uuid not null references public.expenses(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  sent_by    uuid references auth.users(id) on delete set null,
  sent_at    timestamptz not null default now(),
  primary key (expense_id, user_id)
);
alter table public.payment_reminder_log enable row level security;

-- people who can see the expense can see when it was last reminded (the button
-- shows "Reminded · 3h ago"); writes only go through the function below
drop policy if exists payment_reminder_log_read on public.payment_reminder_log;
create policy payment_reminder_log_read on public.payment_reminder_log
  for select to authenticated
  using (public.can_access_expense(expense_id));

create or replace function public.send_payment_reminder(p_expense uuid, p_user uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cooldown constant interval := interval '24 hours';
  v_last   timestamptz;
  v_share  numeric;
  v_status text;
  v_paid   numeric;
  v_title  text;
  v_hh     uuid;
  v_group  uuid;
  v_name   text;
begin
  if not public.is_expense_admin(p_expense) then
    raise exception 'Only the owner can send payment reminders';
  end if;
  if p_user = auth.uid() then
    raise exception 'You cannot remind yourself';
  end if;

  select sp.share_amount, sp.status, coalesce(sp.paid_amount, 0)
    into v_share, v_status, v_paid
    from public.expense_splits sp
   where sp.expense_id = p_expense and sp.user_id = p_user;
  if not found then raise exception 'This member has no share in this expense'; end if;
  if v_status = 'approved' or v_paid >= v_share then raise exception 'This share is already paid'; end if;

  select l.sent_at into v_last
    from public.payment_reminder_log l
   where l.expense_id = p_expense and l.user_id = p_user;
  if v_last is not null and v_last > now() - v_cooldown then
    raise exception 'REMIND_COOLDOWN|%', to_char((v_last + v_cooldown) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;

  select e.title, e.household_id, e.group_id into v_title, v_hh, v_group
    from public.expenses e where e.id = p_expense;
  select coalesce(p.full_name, 'The owner') into v_name from public.profiles p where p.id = auth.uid();

  insert into public.notifications (user_id, title, message, type, link_path, link_state, link_query)
  values (
    p_user,
    '🔔 Payment Reminder',
    format('%s reminded you to pay your ₱%s share for "%s".', v_name, to_char(v_share, 'FM999,999,990.00'), v_title),
    'payment_reminder',
    case when v_hh is not null then '/groups/' || v_hh || '?type=household' else '/groups/' || v_group || '?type=group' end,
    case when v_hh is not null then '{"type":"household"}' else '{"type":"group"}' end,
    'expenseId=' || p_expense
  );

  insert into public.payment_reminder_log (expense_id, user_id, sent_by, sent_at)
  values (p_expense, p_user, auth.uid(), now())
  on conflict (expense_id, user_id) do update
    set sent_by = excluded.sent_by, sent_at = excluded.sent_at;

  return now() + v_cooldown;
end;
$$;

revoke all on function public.send_payment_reminder(uuid, uuid) from public, anon;
grant execute on function public.send_payment_reminder(uuid, uuid) to authenticated;
