begin;

create or replace function public.guard_expense_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if (new.amount, new.title, new.category, new.due_date,
      new.split_type, new.members_split, new.deleted_at)
     is distinct from
     (old.amount, old.title, old.category, old.due_date,
      old.split_type, old.members_split, old.deleted_at) then
    if not (
      public.is_expense_admin(old.id)
      or (old.created_by = auth.uid() and old.approval_status = 'pending_approval')
    ) then
      raise exception 'Only the admin of this household/group can edit or delete this expense';
    end if;
  end if;

  if new.deleted_at is not null and old.deleted_at is null then
    if exists (
      select 1
      from public.expense_splits s
      where s.expense_id = old.id
        and s.user_id is distinct from old.paid_by
        and s.user_id is distinct from auth.uid()
        and (
          s.paid_amount > 0
          or s.status in ('pending_verification', 'partly_paid')
        )
    ) then
      raise exception 'Refund every paid member before deleting this expense';
    end if;
    new.deleted_by := auth.uid();
  end if;

  return new;
end;
$$;

commit;
