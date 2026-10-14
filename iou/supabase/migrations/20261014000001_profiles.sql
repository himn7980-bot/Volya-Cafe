-- Phase 1: profiles, automatic profile creation, avatar storage.
--
-- Privacy rules:
--  * A person can read and edit only their own profile row in this phase.
--    (Later phases expose a limited view of counterparties' profiles.)
--  * phone and email are copied from auth.users by triggers and cannot be
--    written by the client, so nobody can claim someone else's number.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  display_name     text not null default '' check (char_length(display_name) <= 80),
  avatar_path      text,
  phone            text,
  email            text,
  language         text not null default 'en'
                   check (language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  default_currency text not null default 'USD' check (default_currency ~ '^[A-Z]{3}$'),
  digits           text not null default 'latin' check (digits in ('native', 'latin')),
  calendar         text not null default 'gregory' check (calendar in ('gregory', 'persian', 'islamic')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint profiles_avatar_in_own_folder
    check (avatar_path is null or avatar_path like id::text || '/%')
);

comment on table public.profiles is 'One row per user. phone/email mirror auth.users and are read-only for clients.';

create index profiles_phone_idx on public.profiles (phone) where phone is not null;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Create / sync the profile from auth.users
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  lang text := meta ->> 'language';
  cur  text := meta ->> 'default_currency';
begin
  insert into public.profiles (id, phone, email, display_name, language, default_currency, digits, calendar)
  values (
    new.id,
    nullif(new.phone, ''),
    nullif(new.email, ''),
    left(coalesce(meta ->> 'full_name', meta ->> 'name', ''), 80),
    case when lang ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$' then lang else 'en' end,
    case when cur ~ '^[A-Z]{3}$' then cur else 'USD' end,
    case when meta ->> 'digits' in ('native', 'latin') then meta ->> 'digits' else 'latin' end,
    case when meta ->> 'calendar' in ('gregory', 'persian', 'islamic') then meta ->> 'calendar' else 'gregory' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_contact_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
     set phone = nullif(new.phone, ''),
         email = nullif(new.email, '')
   where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_contact_changed
  after update of phone, email on auth.users
  for each row
  when (old.phone is distinct from new.phone or old.email is distinct from new.email)
  execute function public.handle_user_contact_change();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

create policy "profiles: read own"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()));

create policy "profiles: update own"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- No insert/delete policies: rows are created by the trigger and removed by
-- the cascade when the auth user is deleted.

-- Column privileges: clients may only change these columns.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, avatar_path, language, default_currency, digits, calendar)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Avatar storage: private bucket, files live under "<user id>/..."
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "avatars: read own"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: insert own"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: update own"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: delete own"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
