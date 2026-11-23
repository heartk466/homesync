-- Due date reminders (Settings → "Remind me before due date").
--
-- Every day at 8:00 AM Philippine time (00:00 UTC) this finds each member's
-- unpaid shares whose due date is exactly one of their chosen reminder days
-- away (0 = on the day) and adds a "Payment Due" notification. The existing
-- trigger_push_on_notification trigger then sends it to their phone.
--
-- Skipped: members who turned off "Due Date Reminders", shares that are paid or
-- waiting for proof review, deleted / not-yet-approved expenses, and members who
-- left the household. Each reminder is sent once (due_reminder_log).
--
-- Safe to run more than once.

create extension if not exists pg_cron;

create table if not exists public.due_reminder_log (
  user_id    uuid not null references auth.users(id) on delete cascade,
  expense_id uuid not null references public.expenses(id) on delete cascade,
  remind_on  date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, expense_id, remind_on)
);
-- only the job below touches it (no policies = no access for app users)
alter table public.due_reminder_log enable row level security;

create or replace function public.send_due_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_sent  integer := 0;
  r       record;
begin
  for r in
    select
      sp.user_id,
      e.id           as expense_id,
      e.title,
      e.household_id,
      e.group_id,
      e.due_date,
      (e.due_date - v_today) as days_left,
      greatest(sp.share_amount - coalesce(sp.paid_amount, 0), 0) as owed
    from public.expense_splits sp
    join public.expenses e on e.id = sp.expense_id
    join public.profiles p on p.id = sp.user_id
    where e.due_date is not null
      and e.due_date >= v_today
      and e.deleted_at is null
      and e.approval_status = 'approved'
      and sp.status not in ('approved', 'pending_verification')
      and sp.share_amount - coalesce(sp.paid_amount, 0) > 0
      and coalesce(p.deleted, false) = false
      and coalesce((p.notification_preferences ->> 'utility_reminders')::boolean, true)
      and (e.due_date - v_today) = any (
        coalesce(p.reminder_days, array[coalesce(p.default_reminder_days, 3)])
      )
      and (
        e.household_id is null
        or exists (
          select 1 from public.household_members hm
          where hm.household_id = e.household_id
            and hm.user_id = sp.user_id
            and hm.status = 'active'
        )
      )
  loop
    -- once per member, expense and day
    insert into public.due_reminder_log (user_id, expense_id, remind_on)
    values (r.user_id, r.expense_id, v_today)
    on conflict do nothing;
    if not found then
      continue;
    end if;

    insert into public.notifications (user_id, title, message, type, link_path, link_state, link_query)
    values (
      r.user_id,
      case when r.days_left = 0 then 'Payment Due Today' else 'Payment Due Soon' end,
      format(
        'Your share of "%s" (₱%s) is due %s. Tap to pay.',
        r.title,
        to_char(r.owed, 'FM999,999,990.00'),
        case
          when r.days_left = 0 then 'today'
          when r.days_left = 1 then 'tomorrow'
          else 'in ' || r.days_left || ' days (' || to_char(r.due_date, 'Mon FMDD') || ')'
        end
      ),
      'payment_reminder',
      case when r.household_id is not null then '/expenses' else '/groups/' || r.group_id || '?type=group' end,
      case when r.household_id is not null then null else '{"type":"group"}' end,
      case when r.household_id is not null
           then 'householdId=' || r.household_id || '&expenseId=' || r.expense_id
           else 'expenseId=' || r.expense_id end
    );
    v_sent := v_sent + 1;
  end loop;

  -- keep the log small: older days are never checked again
  delete from public.due_reminder_log where remind_on < v_today - 60;

  return v_sent;
end;
$$;

revoke all on function public.send_due_reminders() from public;
revoke all on function public.send_due_reminders() from anon, authenticated;

-- 00:00 UTC = 8:00 AM Asia/Manila. Scheduling the same name again replaces it.
select cron.schedule(
  'due-date-reminders',
  '0 0 * * *',
  $$ select public.send_due_reminders(); $$
);
