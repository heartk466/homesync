-- Scheduled reports: pick a member + per-member split details, like the app's
-- "Generate New Report".
--
--   report_schedules.member_id             null = All Members (Household Total)
--                                          (admin only; a member's schedule is
--                                          always their own share)
--   report_schedules.include_split_details adds each member's share / payment
--
-- Refund sections follow the same rule as manual reports: the household-total
-- or the owner's report lists everyone, a member's report only their own:
--   • "Needs refund" / "Refund still needed" (overpaid, not confirmed yet)
--   • "Refunded for deletion of expense"   (deletion refunds confirmed)
--   • "Refunded for overpaid expense"      (overpayment refunds confirmed)
--
-- Replaces send_scheduled_reports() from 20261028030000_report_refunds.sql
-- (run that one first — it creates split_deletion_state()). Safe to re-run.

begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'report_schedules' and column_name = 'member_id'
  ) then
    alter table public.report_schedules add column member_id uuid;
    -- existing schedules keep reporting the creator's own share
    update public.report_schedules set member_id = user_id;
  end if;
end $$;

alter table public.report_schedules add column if not exists include_split_details boolean not null default false;

create or replace function public.send_scheduled_reports()
returns integer
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  today date := (now() at time zone 'Asia/Manila')::date;   -- Philippine date
  rs record;
  e record;
  n integer := 0;
  period_start date;
  cats jsonb;
  v_scope uuid;            -- null = household total
  v_everyone boolean;      -- list every member's refunds
  v_info jsonb;
  v_mine jsonb;
  v_share numeric;
  v_paid_row numeric;
  v_status text;
  v_excluded boolean;
  v_refunds jsonb;
  v_row jsonb;
  v_cat_totals jsonb;
  v_total numeric;
  v_paid numeric;
  v_count integer;
  v_top text;
  v_rows jsonb;
  v_deletions jsonb;
  v_overpaid jsonb;
  v_refund_total numeric;
  v_deletion_total numeric;
  v_overpaid_total numeric;
  v_report_id uuid;
  v_scope_name text;
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

      -- Only the admin may report on the household total or another member
      v_scope := case when rs.user_id = hh_owner then rs.member_id else rs.user_id end;
      v_everyone := v_scope is null or v_scope = hh_owner;
      select full_name into v_scope_name from profiles where id = v_scope;

      v_rows := '[]'::jsonb;
      v_cat_totals := '{}'::jsonb;
      v_total := 0; v_paid := 0; v_count := 0; v_refund_total := 0;

      for e in
        select x.*
        from expenses x
        where x.household_id = rs.household_id
          and x.approval_status = 'approved'
          and x.deleted_at is null
          and x.expense_date between period_start and today
          and (jsonb_array_length(cats) = 0
               or x.category in (select jsonb_array_elements_text(cats)))
        order by x.expense_date desc
      loop
        -- Every member's share on this expense (same rules as computeReport()):
        -- deletion refund sent → 'verifying for deletion' (counts as paid);
        -- confirmed → 'refunded for deletion' (settled, left out of totals).
        select coalesce(jsonb_agg(jsonb_build_object(
                 'user_id', s.user_id,
                 'name', coalesce(p.full_name, 'Member'),
                 'share', round(s.share_amount, 2),
                 'paid', case when d.state = 'refunded' then 0
                              when d.state = 'verifying' then round(s.share_amount, 2)
                              when s.status = 'approved' then round(s.share_amount, 2)
                              else round(least(coalesce(s.paid_amount, 0), s.share_amount), 2) end,
                 'status', case
                             when d.state = 'verifying' then 'verifying for deletion'
                             when d.state = 'refunded' then 'refunded for deletion'
                             when s.status = 'approved' then 'paid'
                             when s.status = 'partly_paid' then 'partly paid'
                             when s.status = 'pending_verification' then 'verifying'
                             else 'pending' end,
                 'settled', d.state = 'refunded'
               )), '[]'::jsonb)
          into v_info
        from expense_splits s
        left join profiles p on p.id = s.user_id
        cross join lateral (select split_deletion_state(s.expense_id, s.user_id, s.paid_amount) as state) d
        where s.expense_id = e.id;

        v_excluded := false;
        if v_scope is null then
          select round(e.amount - coalesce(sum((i->>'share')::numeric) filter (where (i->>'settled')::boolean), 0), 2),
                 round(coalesce(sum((i->>'paid')::numeric) filter (where not (i->>'settled')::boolean), 0), 2),
                 case
                   when count(*) > 0 and bool_and((i->>'settled')::boolean) then 'refunded for deletion'
                   when count(*) filter (where not (i->>'settled')::boolean) > 0
                        and bool_and((i->>'status') in ('paid', 'verifying for deletion'))
                            filter (where not (i->>'settled')::boolean) then 'paid'
                   when coalesce(sum((i->>'paid')::numeric) filter (where not (i->>'settled')::boolean), 0) > 0 then 'partly paid'
                   else 'pending'
                 end
            into v_share, v_paid_row, v_status
          from jsonb_array_elements(v_info) as t(i);
        else
          select i into v_mine from jsonb_array_elements(v_info) as t(i) where (i->>'user_id')::uuid = v_scope limit 1;
          continue when v_mine is null;               -- not part of this expense
          v_share := (v_mine->>'share')::numeric;
          v_paid_row := (v_mine->>'paid')::numeric;
          v_status := v_mine->>'status';
          v_excluded := (v_mine->>'settled')::boolean;
          continue when v_share <= 0;
        end if;

        -- Overpaid shares still owed (sent-but-unconfirmed refunds still count)
        select coalesce(jsonb_agg(jsonb_build_object(
                 'user_id', q.user_id, 'name', q.name, 'amount', q.amount,
                 'awaiting', least(q.awaiting, q.amount)
               )), '[]'::jsonb)
          into v_refunds
        from (
          select o.user_id,
                 coalesce(p.full_name, 'Member') as name,
                 round(o.paid_amount + coalesce(w.awaiting, 0) - o.share_amount, 2) as amount,
                 coalesce(w.awaiting, 0) as awaiting
          from expense_splits o
          left join profiles p on p.id = o.user_id
          left join lateral (
            select sum(x.amount) as awaiting
            from expense_refunds x
            where x.expense_id = o.expense_id and x.user_id = o.user_id
              and x.status = 'sent' and x.refund_type is distinct from 'expense_deletion'
          ) w on true
          where o.expense_id = e.id
            and (o.status = 'approved' or coalesce(w.awaiting, 0) > 0)
            and o.user_id is distinct from hh_owner
            and (v_everyone or o.user_id = v_scope)
        ) q
        where q.amount > 0.005;

        v_row := jsonb_build_object(
          'id', e.id, 'title', e.title, 'category', e.category,
          'expense_date', e.expense_date, 'amount', round(e.amount, 2),
          'share', v_share, 'paid', least(v_paid_row, v_share), 'status', v_status
        );
        if v_excluded then v_row := v_row || jsonb_build_object('excluded', true); end if;
        if rs.include_split_details then v_row := v_row || jsonb_build_object('splits', v_info); end if;
        if jsonb_array_length(v_refunds) > 0 then
          v_row := v_row || jsonb_build_object('refunds', v_refunds);
          v_refund_total := v_refund_total + (select coalesce(sum((f->>'amount')::numeric), 0) from jsonb_array_elements(v_refunds) as t(f));
        end if;
        v_rows := v_rows || jsonb_build_array(v_row);
        v_count := v_count + 1;

        if not v_excluded then
          v_total := v_total + v_share;
          v_paid := v_paid + least(v_paid_row, v_share);
          v_cat_totals := jsonb_set(v_cat_totals, array[e.category],
            to_jsonb(coalesce((v_cat_totals->>e.category)::numeric, 0) + v_share));
        end if;
      end loop;

      select key into v_top from jsonb_each_text(v_cat_totals) order by value::numeric desc limit 1;

      -- "Refunded for deletion of expense" / "Refunded for overpaid expense":
      -- refunds members confirmed for expenses dated in the period (deleted
      -- expenses included).
      select coalesce(jsonb_agg(jsonb_build_object(
               'entry', case when x.refund_type = 'overpayment' then 'overpaid_refund' else 'deletion_refund' end,
               'refund_id', x.id,
               'expense_id', ex.id,
               'title', ex.title,
               'category', ex.category,
               'expense_date', ex.expense_date,
               'user_id', x.user_id,
               'name', coalesce(p.full_name, 'Member'),
               'amount', round(x.amount, 2),
               'deleted', ex.deleted_at is not null
             ) order by ex.expense_date desc) filter (where x.refund_type = 'expense_deletion'), '[]'::jsonb),
             coalesce(jsonb_agg(jsonb_build_object(
               'entry', 'overpaid_refund',
               'refund_id', x.id,
               'expense_id', ex.id,
               'title', ex.title,
               'category', ex.category,
               'expense_date', ex.expense_date,
               'user_id', x.user_id,
               'name', coalesce(p.full_name, 'Member'),
               'amount', round(x.amount, 2),
               'deleted', ex.deleted_at is not null
             ) order by ex.expense_date desc) filter (where x.refund_type = 'overpayment'), '[]'::jsonb),
             coalesce(sum(x.amount) filter (where x.refund_type = 'expense_deletion'), 0),
             coalesce(sum(x.amount) filter (where x.refund_type = 'overpayment'), 0)
        into v_deletions, v_overpaid, v_deletion_total, v_overpaid_total
      from expense_refunds x
      join expenses ex on ex.id = x.expense_id
      left join profiles p on p.id = x.user_id
      where ex.household_id = rs.household_id
        and ex.expense_date between period_start and today
        and x.refund_type in ('expense_deletion', 'overpayment')
        and x.status = 'confirmed'
        and (v_everyone or x.user_id = v_scope)
        and (jsonb_array_length(cats) = 0
             or ex.category in (select jsonb_array_elements_text(cats)));

      -- Save the report so it shows up in Statement History
      insert into generated_reports (
        household_id, generated_by, member_id, kind, period_from, period_to,
        categories, include_split_details, total, paid, pending, expense_count, rows
      ) values (
        rs.household_id, rs.user_id, v_scope, 'scheduled', period_start, today,
        array(select jsonb_array_elements_text(cats)), coalesce(rs.include_split_details, false),
        round(v_total, 2), round(v_paid, 2), round(greatest(v_total - v_paid, 0), 2), v_count,
        v_rows || v_deletions || v_overpaid
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
                    case when v_scope is null then 'Household total: ₱'
                         when v_scope = rs.user_id then 'Your share: ₱'
                         else coalesce(v_scope_name, 'Member') || '''s share: ₱' end ||
                    to_char(v_total, 'FM999,999,990.00') ||
                    ' (paid ₱' || to_char(v_paid, 'FM999,999,990.00') ||
                    ', pending ₱' || to_char(greatest(v_total - v_paid, 0), 'FM999,999,990.00') ||
                    ') across ' || v_count || case when v_count = 1 then ' expense.' else ' expenses.' end ||
                    case when v_top is not null then ' Top category: ' || v_top || '.' else '' end;
      end if;

      if v_refund_total > 0 then
        msg_body := msg_body ||
                    case when v_everyone then ' Needs refund: ₱' else ' Refund still needed: ₱' end ||
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

commit;
