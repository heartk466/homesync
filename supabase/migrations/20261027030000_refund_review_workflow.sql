begin;

alter table public.expense_refunds
  drop constraint if exists expense_refunds_status_check;

alter table public.expense_refunds
  add constraint expense_refunds_status_check
  check (status in ('sent', 'confirmed', 'rejected'));

alter table public.expense_refunds
  add column if not exists rejection_reason text;

create or replace function public.guard_refund_confirmation_for_rls()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and old.user_id = auth.uid()
     and old.status = 'sent'
     and new.status in ('confirmed', 'rejected') then
    return new;
  end if;
  if auth.uid() is null or public.is_expense_admin(old.expense_id) then
    return new;
  end if;
  raise exception 'Only the recipient can review this refund';
end;
$$;

create or replace function public.guard_refund_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.expense_id := old.expense_id;
  new.user_id := old.user_id;
  new.amount := old.amount;
  new.refund_type := old.refund_type;
  new.screenshot_url := old.screenshot_url;
  new.note := old.note;
  new.sent_by := old.sent_by;
  new.created_at := old.created_at;

  if new.status = 'confirmed' and old.status = 'sent' then
    new.confirmed_at := now();
    new.rejection_reason := null;
  elsif new.status = 'rejected' and old.status = 'sent' then
    new.confirmed_at := null;
    if nullif(trim(new.rejection_reason), '') is null then
      raise exception 'A rejection reason is required';
    end if;
  elsif new.status is distinct from old.status then
    raise exception 'Refund decisions can only be made once';
  else
    new.rejection_reason := old.rejection_reason;
    new.confirmed_at := old.confirmed_at;
  end if;

  return new;
end;
$$;

create or replace function public.apply_refund()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if tg_op = 'INSERT' then
    update public.expense_splits
    set paid_amount = paid_amount - new.amount,
        status = case
          when status in ('approved', 'partly_paid') then
            case when paid_amount - new.amount >= share_amount then 'approved'
                 when paid_amount - new.amount > 0 then 'partly_paid'
                 else 'unpaid' end
          else status
        end,
        updated_at = now()
    where expense_id = new.expense_id and user_id = new.user_id;
  elsif old.status = 'sent' and new.status = 'rejected' then
    update public.expense_splits
    set paid_amount = paid_amount + old.amount,
        status = case
          when paid_amount + old.amount >= share_amount then 'approved'
          when paid_amount + old.amount > 0 then 'partly_paid'
          else 'unpaid' end,
        updated_at = now()
    where expense_id = old.expense_id and user_id = old.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_apply_refund on public.expense_refunds;
create trigger trg_apply_refund
after insert or update of status on public.expense_refunds
for each row execute function public.apply_refund();

commit;
