-- Phone push on every device a member turned it on (was: one device per
-- account, the newest replacing the previous one).
--
-- push_subscriptions becomes one row per device (unique endpoint) instead of
-- one per user. Devices register through save_push_subscription(), which also
-- moves a device to whoever is logged in on it now (two accounts on one phone
-- would otherwise both get that phone's pushes).
--
-- Order: run this, deploy the new send-push function, then ship the app.
-- Safe to run more than once.

alter table public.push_subscriptions add column if not exists endpoint text;
update public.push_subscriptions
   set endpoint = subscription ->> 'endpoint'
 where endpoint is null;

-- one row per device: keep the newest if a device was ever saved twice
delete from public.push_subscriptions a
 using public.push_subscriptions b
 where a.endpoint = b.endpoint
   and (coalesce(a.created_at, 'epoch'), a.id) < (coalesce(b.created_at, 'epoch'), b.id);

alter table public.push_subscriptions alter column endpoint set not null;
alter table public.push_subscriptions drop constraint if exists push_subscriptions_user_id_key;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'push_subscriptions_endpoint_key') then
    alter table public.push_subscriptions add constraint push_subscriptions_endpoint_key unique (endpoint);
  end if;
end $$;
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

-- Save this device for the logged-in user
create or replace function public.save_push_subscription(p_subscription jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_endpoint text := p_subscription ->> 'endpoint';
begin
  if auth.uid() is null then
    raise exception 'Not logged in';
  end if;
  if v_endpoint is null or v_endpoint = '' then
    raise exception 'Subscription has no endpoint';
  end if;
  insert into public.push_subscriptions (user_id, subscription, endpoint)
  values (auth.uid(), p_subscription, v_endpoint)
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        subscription = excluded.subscription,
        created_at = now();
end;
$$;

revoke all on function public.save_push_subscription(jsonb) from public, anon;
grant execute on function public.save_push_subscription(jsonb) to authenticated;
