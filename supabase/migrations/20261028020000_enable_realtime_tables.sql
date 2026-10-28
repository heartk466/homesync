-- Turns on live updates (Supabase Realtime) for every table the app listens to:
--   expenses, expense_splits      → Expenses badge, expense lists, household/group screen
--   payment_proofs                → household/group screen refreshes when proofs change
--   expense_refunds               → Expenses badge (refunds waiting for a member's review)
--   notifications                 → notification bell
--   chat_messages                 → chat + unread count
--   name_change_requests          → rename requests on the household/group screen
--   households, groups            → household/group name changes
--
-- Safe to run more than once and on any project: it creates the publication if
-- it's missing and only adds tables that aren't in it yet.
-- Realtime still respects RLS, so users only receive rows they can already see.

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array array[
    'expenses',
    'expense_splits',
    'payment_proofs',
    'expense_refunds',
    'notifications',
    'chat_messages',
    'name_change_requests',
    'households',
    'groups'
  ]
  loop
    if to_regclass(format('public.%I', t)) is null then
      raise notice 'Skipping %: table does not exist in this project', t;
    elsif not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'Added % to supabase_realtime', t;
    end if;
  end loop;
end $$;

-- Check the result: should list all 9 tables.
select tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;
