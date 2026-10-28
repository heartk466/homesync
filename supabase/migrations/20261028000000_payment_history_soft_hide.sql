begin;

-- ── Soft-delete metadata for every kind of proof shown in Payment History ──
--   hidden_by_member: the member tucked a rejected entry out of their own view
--                     (admins still see it).
--   image_deleted_at: the scheduled cleanup removed the screenshot file; the row
--                     (amount, status, reason, dates) is kept as history.
alter table public.payment_proofs
  add column if not exists hidden_by_member boolean not null default false,
  add column if not exists image_deleted_at timestamptz;

alter table public.expense_followup_proofs
  add column if not exists hidden_by_member boolean not null default false,
  add column if not exists image_deleted_at timestamptz;

alter table public.expense_refunds
  add column if not exists hidden_by_member boolean not null default false,
  add column if not exists image_deleted_at timestamptz;

create index if not exists idx_payment_proofs_rejected_cleanup
  on public.payment_proofs (created_at)
  where status = 'rejected' and image_deleted_at is null and screenshot_url is not null;
create index if not exists idx_followup_proofs_rejected_cleanup
  on public.expense_followup_proofs (created_at)
  where status = 'rejected' and image_deleted_at is null and screenshot_url is not null;
create index if not exists idx_refunds_rejected_cleanup
  on public.expense_refunds (created_at)
  where status = 'rejected' and image_deleted_at is null and screenshot_url is not null;

-- Set only inside set_rejected_proof_hidden() (transaction-local), so the
-- update guards below can let exactly that one column change through.
create or replace function public.is_proof_visibility_change()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('homesync.proof_visibility_change', true), '') = 'on';
$$;

-- ── payment_proofs: admins review, the service role cleans up, and the
--    visibility RPC may flip hidden_by_member. Nothing else. ──
create or replace function public.guard_payment_proof_update_for_rls()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if public.is_proof_visibility_change() then
    if (to_jsonb(new) - 'hidden_by_member') <> (to_jsonb(old) - 'hidden_by_member') then
      raise exception 'Only proof visibility may be changed';
    end if;
    return new;
  end if;

  if public.is_expense_admin(old.expense_id) then
    if (to_jsonb(new) - array['status', 'rejection_reason'])
       <> (to_jsonb(old) - array['status', 'rejection_reason']) then
      raise exception 'Only proof status and rejection reason may be changed';
    end if;
    return new;
  end if;

  raise exception 'Only the expense owner can review payment proofs';
end;
$$;

-- ── expense_refunds ──
create or replace function public.guard_refund_confirmation_for_rls()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_proof_visibility_change() then
    return new;
  end if;
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
  if public.is_proof_visibility_change() then
    if (to_jsonb(new) - 'hidden_by_member') <> (to_jsonb(old) - 'hidden_by_member') then
      raise exception 'Only refund visibility may be changed';
    end if;
    return new;
  end if;

  -- Scheduled image cleanup (service role): drop the file reference only.
  if auth.uid() is null
     and old.image_deleted_at is null
     and new.image_deleted_at is not null
     and new.screenshot_url is null
     and (to_jsonb(new) - array['screenshot_url', 'image_deleted_at'])
         = (to_jsonb(old) - array['screenshot_url', 'image_deleted_at']) then
    return new;
  end if;

  new.expense_id := old.expense_id;
  new.user_id := old.user_id;
  new.amount := old.amount;
  new.refund_type := old.refund_type;
  new.screenshot_url := old.screenshot_url;
  new.note := old.note;
  new.sent_by := old.sent_by;
  new.created_at := old.created_at;
  new.hidden_by_member := old.hidden_by_member;
  new.image_deleted_at := old.image_deleted_at;

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

-- ── Member hides / unhides one of their own rejected entries ──
--   p_kind: 'main' (payment_proofs), 'followup', 'refund'
create or replace function public.set_rejected_proof_hidden(p_kind text, p_id uuid, p_hidden boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  perform set_config('homesync.proof_visibility_change', 'on', true);

  if p_kind = 'main' then
    update public.payment_proofs
    set hidden_by_member = p_hidden
    where id = p_id and submitted_by = auth.uid() and status = 'rejected';
  elsif p_kind = 'followup' then
    update public.expense_followup_proofs
    set hidden_by_member = p_hidden
    where id = p_id and user_id = auth.uid() and status = 'rejected';
  elsif p_kind = 'refund' then
    update public.expense_refunds
    set hidden_by_member = p_hidden
    where id = p_id and user_id = auth.uid() and status = 'rejected';
  else
    raise exception 'Unknown proof kind: %', p_kind;
  end if;
  get diagnostics v_count = row_count;

  perform set_config('homesync.proof_visibility_change', '', true);

  if v_count = 0 then
    raise exception 'Only your own rejected entries can be hidden';
  end if;
end;
$$;

revoke all on function public.is_proof_visibility_change() from public;
revoke all on function public.set_rejected_proof_hidden(text, uuid, boolean) from public;
grant execute on function public.set_rejected_proof_hidden(text, uuid, boolean) to authenticated;

commit;

-- Make the API (PostgREST) see the new function and columns right away.
notify pgrst, 'reload schema';
