-- Scheduled reports: refunds, the same way the app's manual reports show them.
--
-- 1. Overpayment refunds still owed — each report row gets
--    "refunds": [{ user_id, name, amount, awaiting }]:
--      * the household owner's report lists every overpaid member ("Needs refund")
--      * a member's report lists only their own ("Refund still needed")
--    A sent refund lowers paid_amount right away (apply_refund trigger), but it
--    still counts as owed until the member confirms it, so 'sent' refunds are
--    added back.
--
-- 2. Deletion refunds (the admin refunding a member so an expense can be deleted):
--      * sent, not confirmed yet → the row says 'verifying for deletion' and the
--        share still counts as paid
--      * confirmed → 'refunded for deletion'; the row is listed but left out of
--        the totals (the money went back), marked "excluded": true
--    Confirmed deletion refunds are also added to the report's rows as
--    { "entry": "deletion_refund", ... } — the app shows them in the purple
--    "Refunded for deletion of expense" box (the owner's report lists everyone,
--    a member's report only their own), even once the expense is deleted.
--
-- 3. Overpayment refunds the member confirmed (approved the refund proof) are
--    added as { "entry": "overpaid_refund", ... } — the app's
--    "Refunded for overpaid expense" box. Same who-sees-what rule as above.
--
-- Safe to run more than once.

begin;

-- Same rule as deletionStateOf() in src/utils/refundsOwed.js:
--   'verifying' – a deletion refund to this member is waiting for them
--   'refunded'  – their newest deletion refund was confirmed and nothing is paid
--   null        – neither
create or replace function public.split_deletion_state(p_expense_id uuid, p_user_id uuid, p_paid numeric)
returns text
language sql
stable
security definer
set search_path = 'public'
as $$
  select case
    when exists (
      select 1 from expense_refunds x
      where x.expense_id = p_expense_id and x.user_id = p_user_id
        and x.refund_type = 'expense_deletion' and x.status = 'sent'
    ) then 'verifying'
    when coalesce(p_paid, 0) <= 0.001 and (
      select x.status from expense_refunds x
      where x.expense_id = p_expense_id and x.user_id = p_user_id
        and x.refund_type = 'expense_deletion'
      order by x.created_at desc
      limit 1
    ) = 'confirmed' then 'refunded'
  end;
$$;

create or replace function public.send_scheduled_reports()
returns integer
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  today date := (now() at time zone 'Asia/Manila')::date;   -- Philippine date
  rs record;
  n integer := 0;
  period_start date;
  cats jsonb;
  v_total numeric;
  v_paid numeric;
  v_count integer;
  v_top text;
  v_rows jsonb;
  v_deletions jsonb;
  v_overpaid jsonb;
  v_overpaid_total numeric;
  v_refund_total numeric;
  v_deletion_total numeric;
  v_report_id uuid;
  hh_name text;
  hh_owner uuid;
  wants boolean;
  msg_title text;
  msg_body text;
  nxt date;
begin
  for rs in
    select *
    from report_schedules
    where is_active is true
      and next_scheduled_at is not null
      and (next_scheduled_at at time zone 'Asia/Manila')::date <= today
  loop
    -- Period covered by this report
    if rs.frequency = 'monthly' then
      period_start := (today - interval '1 month')::date;
    elsif rs.frequency = 'weekly' then
      period_start := today - 7;
    else
      period_start := today - greatest(coalesce(rs.custom_interval_days, 1), 1);
    end if;

    -- Category filter (works whether the column is text[] or jsonb)
    cats := coalesce(to_jsonb(rs.category_filter), '[]'::jsonb);
    if jsonb_typeof(cats) <> 'array' then cats := '[]'::jsonb; end if;

    -- Does this user want report notifications?
    select coalesce(notification_preferences->>'report_schedules', 'true') <> 'false'
      into wants
    from profiles where id = rs.user_id;

    if coalesce(wants, false) then
      select name, created_by into hh_name, hh_owner from households where id = rs.household_id;

      -- The user's own share in the period.
      -- "paid" = what the admin has approved (approved split, or paid_amount
      -- for a partly paid one); soft-deleted expenses are ignored.
      -- Deletion refunds: 'verifying' still counts as paid; 'refunded' is left out.
      select coalesce(sum(case when d.state = 'refunded' then 0 else s.share_amount end), 0),
             coalesce(sum(case when d.state = 'refunded' then 0
                               when d.state = 'verifying' then s.share_amount
                               when s.status = 'approved' then s.share_amount
                               else least(coalesce(s.paid_amount, 0), s.share_amount) end), 0),
             count(*)
        into v_total, v_paid, v_count
      from expense_splits s
      join expenses e on e.id = s.expense_id
      cross join lateral (select split_deletion_state(s.expense_id, s.user_id, s.paid_amount) as state) d
      where e.household_id = rs.household_id
        and s.user_id = rs.user_id
        and e.approval_status = 'approved'
        and e.deleted_at is null
        and e.expense_date between period_start and today
        and (jsonb_array_length(cats) = 0
             or e.category in (select jsonb_array_elements_text(cats)));

      select e.category
        into v_top
      from expense_splits s
      join expenses e on e.id = s.expense_id
      where e.household_id = rs.household_id
        and s.user_id = rs.user_id
        and e.approval_status = 'approved'
        and e.deleted_at is null
        and e.expense_date between period_start and today
        and (jsonb_array_length(cats) = 0
             or e.category in (select jsonb_array_elements_text(cats)))
      group by e.category
      order by sum(s.share_amount) desc
      limit 1;

      -- Snapshot rows (same shape the app saves for manual reports)
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', e.id,
               'title', e.title,
               'category', e.category,
               'expense_date', e.expense_date,
               'amount', e.amount,
               'share', s.share_amount,
               'paid', case when d.state = 'refunded' then 0
                            when d.state = 'verifying' then s.share_amount
                            when s.status = 'approved' then s.share_amount
                            else least(coalesce(s.paid_amount, 0), s.share_amount) end,
               'status', case
                           when d.state = 'verifying' then 'verifying for deletion'
                           when d.state = 'refunded' then 'refunded for deletion'
                           when s.status = 'approved' then 'paid'
                           when s.status = 'partly_paid' then 'partly paid'
                           when s.status = 'pending_verification' then 'verifying'
                           else 'pending' end,
               'excluded', d.state = 'refunded',
               'refunds', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'user_id', q.user_id,
                          'name', q.name,
                          'amount', q.amount,
                          'awaiting', least(q.awaiting, q.amount)
                        )), '[]'::jsonb)
                 from (
                   select o.user_id,
                          coalesce(p.full_name, 'Member') as name,
                          round(o.paid_amount + coalesce(w.awaiting, 0) - o.share_amount, 2) as amount,
                          coalesce(w.awaiting, 0) as awaiting
                   from expense_splits o
                   left join profiles p on p.id = o.user_id
                   left join lateral (
                     -- sent overpayment refunds the member hasn't confirmed yet are still owed
                     select sum(x.amount) as awaiting
                     from expense_refunds x
                     where x.expense_id = o.expense_id
                       and x.user_id = o.user_id
                       and x.status = 'sent'
                       and x.refund_type is distinct from 'expense_deletion'
                   ) w on true
                   where o.expense_id = e.id
                     and (o.status = 'approved' or coalesce(w.awaiting, 0) > 0)
                     and o.user_id is distinct from hh_owner
                     and (rs.user_id = hh_owner or o.user_id = rs.user_id)
                 ) q
                 where q.amount > 0.005
               )
             ) order by e.expense_date desc), '[]'::jsonb)
        into v_rows
      from expense_splits s
      join expenses e on e.id = s.expense_id
      cross join lateral (select split_deletion_state(s.expense_id, s.user_id, s.paid_amount) as state) d
      where e.household_id = rs.household_id
        and s.user_id = rs.user_id
        and e.approval_status = 'approved'
        and e.deleted_at is null
        and e.expense_date between period_start and today
        and (jsonb_array_length(cats) = 0
             or e.category in (select jsonb_array_elements_text(cats)));

      select coalesce(sum((f->>'amount')::numeric), 0)
        into v_refund_total
      from jsonb_array_elements(v_rows) r,
           jsonb_array_elements(coalesce(r->'refunds', '[]'::jsonb)) f;

      -- "Refunded for deletion of expense": deletion refunds members confirmed for
      -- expenses dated in the period — deleted expenses included. The owner's
      -- report lists everyone, a member's report only their own.
      select coalesce(jsonb_agg(jsonb_build_object(
               'entry', 'deletion_refund',
               'expense_id', e.id,
               'title', e.title,
               'category', e.category,
               'expense_date', e.expense_date,
               'user_id', x.user_id,
               'name', coalesce(p.full_name, 'Member'),
               'amount', round(x.amount, 2),
               'deleted', e.deleted_at is not null
             ) order by e.expense_date desc), '[]'::jsonb),
             coalesce(sum(x.amount), 0)
        into v_deletions, v_deletion_total
      from expense_refunds x
      join expenses e on e.id = x.expense_id
      left join profiles p on p.id = x.user_id
      where e.household_id = rs.household_id
        and e.expense_date between period_start and today
        and x.refund_type = 'expense_deletion'
        and x.status = 'confirmed'
        and (rs.user_id = hh_owner or x.user_id = rs.user_id)
        and (jsonb_array_length(cats) = 0
             or e.category in (select jsonb_array_elements_text(cats)));

      -- "Refunded for overpaid expense": overpayment refunds members confirmed
      -- for expenses dated in the period.
      select coalesce(jsonb_agg(jsonb_build_object(
               'entry', 'overpaid_refund',
               'refund_id', x.id,
               'expense_id', e.id,
               'title', e.title,
               'category', e.category,
               'expense_date', e.expense_date,
               'user_id', x.user_id,
               'name', coalesce(p.full_name, 'Member'),
               'amount', round(x.amount, 2),
               'deleted', e.deleted_at is not null
             ) order by e.expense_date desc), '[]'::jsonb),
             coalesce(sum(x.amount), 0)
        into v_overpaid, v_overpaid_total
      from expense_refunds x
      join expenses e on e.id = x.expense_id
      left join profiles p on p.id = x.user_id
      where e.household_id = rs.household_id
        and e.expense_date between period_start and today
        and x.refund_type = 'overpayment'
        and x.status = 'confirmed'
        and (rs.user_id = hh_owner or x.user_id = rs.user_id)
        and (jsonb_array_length(cats) = 0
             or e.category in (select jsonb_array_elements_text(cats)));

      -- Save the report so it shows up in Statement History
      insert into generated_reports (
        household_id, generated_by, member_id, kind, period_from, period_to,
        categories, include_split_details, total, paid, pending, expense_count, rows
      ) values (
        rs.household_id, rs.user_id, rs.user_id, 'scheduled', period_start, today,
        array(select jsonb_array_elements_text(cats)), false,
        v_total, v_paid, greatest(v_total - v_paid, 0), v_count, v_rows || v_deletions || v_overpaid
      )
      returning id into v_report_id;

      msg_title := case rs.frequency
                     when 'monthly' then 'Your monthly report is ready'
                     when 'weekly'  then 'Your weekly report is ready'
                     else 'Your report is ready'
                   end;

      msg_body := coalesce(hh_name, 'Household') || ' · ' ||
                  to_char(period_start, 'Mon DD') || ' – ' || to_char(today, 'Mon DD, YYYY') || '. ';

      if v_count = 0 then
        msg_body := msg_body || 'No expenses in this period.';
      else
        msg_body := msg_body ||
                    'Your share: ₱' || to_char(v_total, 'FM999,999,990.00') ||
                    ' (paid ₱' || to_char(v_paid, 'FM999,999,990.00') ||
                    ', pending ₱' || to_char(greatest(v_total - v_paid, 0), 'FM999,999,990.00') ||
                    ') across ' || v_count || case when v_count = 1 then ' expense.' else ' expenses.' end ||
                    case when v_top is not null then ' Top category: ' || v_top || '.' else '' end;
      end if;

      if v_refund_total > 0 then
        msg_body := msg_body ||
                    case when rs.user_id = hh_owner then ' Needs refund: ₱' else ' Refund still needed: ₱' end ||
                    to_char(v_refund_total, 'FM999,999,990.00') || '.';
      end if;

      if v_deletion_total > 0 then
        msg_body := msg_body || ' Refunded for deletion: ₱' || to_char(v_deletion_total, 'FM999,999,990.00') || '.';
      end if;

      if v_overpaid_total > 0 then
        msg_body := msg_body || ' Refunded for overpaid: ₱' || to_char(v_overpaid_total, 'FM999,999,990.00') || '.';
      end if;

      insert into notifications (user_id, title, message, type, link_path, link_query)
      values (rs.user_id, msg_title, msg_body, 'report_schedule', '/reports', 'report=' || v_report_id::text);
      n := n + 1;
    end if;

    -- Move the schedule forward to its next date (skips any missed dates)
    nxt := (rs.next_scheduled_at at time zone 'Asia/Manila')::date;
    loop
      if rs.frequency = 'monthly' then
        nxt := (date_trunc('month', nxt::timestamp) + interval '1 month')::date
               + (least(greatest(coalesce(rs.day_of_month, 1), 1), 28) - 1);
      elsif rs.frequency = 'weekly' then
        nxt := nxt + 7;
      else
        nxt := nxt + greatest(coalesce(rs.custom_interval_days, 1), 1);
      end if;
      exit when nxt > today;
    end loop;

    update report_schedules
    set next_scheduled_at = (nxt::timestamp at time zone 'Asia/Manila'),
        last_sent_at = now()
    where id = rs.id;
  end loop;

  return n;
end;
$$;

-- Only the scheduled job (and the report function above) needs this helper.
revoke all on function public.split_deletion_state(uuid, uuid, numeric) from public, anon, authenticated;

commit;
