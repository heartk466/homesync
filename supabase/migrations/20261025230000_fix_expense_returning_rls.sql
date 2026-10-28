begin;

drop policy if exists expenses_read_context_members on public.expenses;
create policy expenses_read_context_members
on public.expenses for select to authenticated
using (
  created_by = auth.uid()
  or paid_by = auth.uid()
  or public.is_active_household_member(household_id)
  or public.is_active_group_member(group_id)
);

commit;
