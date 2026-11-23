-- Chat photos / files: the "chat-files" storage bucket and who can use it.
--   • public bucket — the app links images with getPublicUrl()
--   • logged-in users can upload into a chat room folder ("<room id>/…") of a
--     room they belong to (the household / group the room is for)
--   • uploaders can delete their own files

insert into storage.buckets (id, name, public)
values ('chat-files', 'chat-files', true)
on conflict (id) do update set public = true;

-- Is this user in the household / group this chat room belongs to?
create or replace function public.chat_room_member(p_room text, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select exists (
    select 1
    from chat_rooms r
    where r.id::text = p_room
      and (
        (r.type = 'household' and exists (
          select 1 from household_members m
          where m.household_id = r.ref_id and m.user_id = p_user and m.status = 'active'))
        or (r.type = 'group' and exists (
          select 1 from group_members g
          where g.group_id = r.ref_id and g.user_id = p_user))
        or (r.type not in ('household', 'group'))
      )
  );
$$;
grant execute on function public.chat_room_member(text, uuid) to authenticated;

drop policy if exists "chat files: members upload" on storage.objects;
create policy "chat files: members upload"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-files'
  and public.chat_room_member((storage.foldername(name))[1], auth.uid())
);

drop policy if exists "chat files: read" on storage.objects;
create policy "chat files: read"
on storage.objects for select
using (bucket_id = 'chat-files');

drop policy if exists "chat files: delete own" on storage.objects;
create policy "chat files: delete own"
on storage.objects for delete to authenticated
using (bucket_id = 'chat-files' and owner = auth.uid());
