-- Chat: photos sent together show as one group, and forwarded messages are marked.
--   batch_id  — same value on every photo sent in one go (the app groups them)
--   forwarded — the message was forwarded from another chat
alter table public.chat_messages add column if not exists batch_id text;
alter table public.chat_messages add column if not exists forwarded boolean not null default false;
