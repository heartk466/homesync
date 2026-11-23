-- The owner is no longer "automatically paid" for an expense they paid.
-- Like any member, their share stays Unpaid until a payment proof exists;
-- the owner's own proof is verified instantly by the app (confirmOwnerPayment).

begin;

create or replace function public.handle_expense_splits_upsert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_member uuid;
  v_share  numeric;
begin
  -- Remove only members who left the split AND have nothing paid / pending
  if tg_op = 'UPDATE' then
    delete from expense_splits es
    where es.expense_id = new.id
      and not (coalesce(new.members_split, '{}'::jsonb) ? es.user_id::text)
      and es.status = 'unpaid'
      and coalesce(es.paid_amount, 0) = 0;
  end if;

  for v_member, v_share in
    select key::uuid, value::numeric
    from jsonb_each_text(coalesce(new.members_split, '{}'::jsonb))
  loop
    insert into expense_splits (expense_id, user_id, share_amount, status, updated_at)
    values (new.id, v_member, v_share, 'unpaid', now())
    on conflict (expense_id, user_id) do update set
      share_amount = excluded.share_amount,
      status = case
        -- paid before, but share went UP  -> follow-up payment needed
        when expense_splits.status = 'approved'
             and expense_splits.paid_amount < excluded.share_amount then 'partly_paid'
        -- was partly paid, share went DOWN to what they already paid -> settled
        when expense_splits.status = 'partly_paid'
             and expense_splits.paid_amount >= excluded.share_amount then 'approved'
        else expense_splits.status
      end,
      updated_at = now();
  end loop;

  return new;
end;
$$;

-- ── Fix shares the old rule auto-approved ──
-- Owner shares marked Paid with no proof at all (no linked proof, no verified
-- proof, no follow-ups, no refunds) go back to Unpaid so the owner can upload one.
with auto_paid as (
  select es.id, es.expense_id
  from public.expense_splits es
  join public.expenses e on e.id = es.expense_id
  left join public.households h on h.id = e.household_id
  left join public.groups g on g.id = e.group_id
  where es.status = 'approved'
    and es.proof_id is null
    and e.deleted_at is null
    and es.user_id = coalesce(h.created_by, g.created_by)
    and not exists (
      select 1 from public.payment_proofs pp
      where pp.expense_id = es.expense_id and pp.submitted_by = es.user_id and pp.status = 'verified'
    )
    and not exists (
      select 1 from public.expense_followup_proofs fp
      where fp.expense_id = es.expense_id and fp.user_id = es.user_id
    )
    and not exists (
      select 1 from public.expense_refunds er
      where er.expense_id = es.expense_id and er.user_id = es.user_id
    )
), reset as (
  update public.expense_splits es
  set status = 'unpaid', paid_amount = 0, updated_at = now()
  from auto_paid
  where es.id = auto_paid.id
  returning es.expense_id
)
-- Those expenses are no longer fully paid.
update public.expenses e
set status = 'pending'
where e.id in (select expense_id from reset)
  and e.status = 'paid';

commit;
