begin;

create or replace function public.can_access_payment_proof_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.payment_proofs pp
    where pp.screenshot_url = p_name
      and (
        (pp.expense_id is not null and public.can_access_expense(pp.expense_id))
        or (pp.utility_id is not null and public.can_access_utility(pp.utility_id))
      )
  )
  or exists (
    select 1
    from public.expense_followup_proofs fp
    where fp.screenshot_url = p_name
      and public.can_access_expense(fp.expense_id)
  )
  or exists (
    select 1
    from public.expense_refunds er
    where er.screenshot_url = p_name
      and public.can_access_expense(er.expense_id)
  );
$$;

revoke all on function public.can_access_payment_proof_object(text) from public;
grant execute on function public.can_access_payment_proof_object(text) to authenticated;
grant execute on function public.can_access_payment_proof_object(text) to anon;

update public.payment_proofs
set screenshot_url = regexp_replace(
  screenshot_url,
  '^https?://[^/]+/storage/v1/object/public/payment-proofs/',
  ''
)
where screenshot_url ~ '^https?://[^/]+/storage/v1/object/public/payment-proofs/';

update public.expense_followup_proofs
set screenshot_url = regexp_replace(
  screenshot_url,
  '^https?://[^/]+/storage/v1/object/public/payment-proofs/',
  ''
)
where screenshot_url ~ '^https?://[^/]+/storage/v1/object/public/payment-proofs/';

update public.expense_refunds
set screenshot_url = regexp_replace(
  screenshot_url,
  '^https?://[^/]+/storage/v1/object/public/payment-proofs/',
  ''
)
where screenshot_url ~ '^https?://[^/]+/storage/v1/object/public/payment-proofs/';

drop policy if exists payment_proof_objects_read on storage.objects;
create policy payment_proof_objects_read
on storage.objects for select to authenticated
using (
  bucket_id = 'payment-proofs'
  and public.can_access_payment_proof_object(name)
);

drop policy if exists payment_proof_objects_read_guard on storage.objects;
create policy payment_proof_objects_read_guard
on storage.objects as restrictive for select to public
using (
  bucket_id <> 'payment-proofs'
  or public.can_access_payment_proof_object(name)
);

drop policy if exists payment_proof_objects_upload_own on storage.objects;
create policy payment_proof_objects_upload_own
on storage.objects for insert to authenticated
with check (
  bucket_id = 'payment-proofs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists payment_proof_objects_insert_guard on storage.objects;
create policy payment_proof_objects_insert_guard
on storage.objects as restrictive for insert to public
with check (
  bucket_id <> 'payment-proofs'
  or (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists payment_proof_objects_update_own on storage.objects;
create policy payment_proof_objects_update_own
on storage.objects for update to authenticated
using (
  bucket_id = 'payment-proofs'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'payment-proofs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists payment_proof_objects_update_guard on storage.objects;
create policy payment_proof_objects_update_guard
on storage.objects as restrictive for update to public
using (
  bucket_id <> 'payment-proofs'
  or (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id <> 'payment-proofs'
  or (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists payment_proof_objects_delete_own on storage.objects;
create policy payment_proof_objects_delete_own
on storage.objects for delete to authenticated
using (
  bucket_id = 'payment-proofs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists payment_proof_objects_delete_guard on storage.objects;
create policy payment_proof_objects_delete_guard
on storage.objects as restrictive for delete to public
using (
  bucket_id <> 'payment-proofs'
  or (storage.foldername(name))[1] = auth.uid()::text
);

commit;
