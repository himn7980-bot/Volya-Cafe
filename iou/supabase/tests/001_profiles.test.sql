-- Profiles: automatic creation, privacy and column protection.
begin;

create temp table ids (name text primary key, id uuid) on commit drop;
grant all on ids to anon, authenticated;
insert into ids values
  ('ali',  tests.new_user('ali@example.com', null, '{"language":"fa","default_currency":"IRR","calendar":"persian","digits":"native"}')),
  ('sara', tests.new_user(null, '+905321234567', '{"language":"not a language!"}'));

-- Profile rows are created from auth.users -----------------------------------
select tests.check(
  (select language = 'fa' and default_currency = 'IRR' and calendar = 'persian' and digits = 'native'
     and email = 'ali@example.com'
   from public.profiles where id = (select id from ids where name = 'ali')),
  'new profile takes preferences from sign-up metadata');

select tests.check(
  (select language = 'en' and phone = '+905321234567'
   from public.profiles where id = (select id from ids where name = 'sara')),
  'invalid metadata falls back to defaults; phone copied');

-- Each person sees only their own profile --------------------------------------
select tests.as_user((select id from ids where name = 'ali'));

select tests.check((select count(*) from public.profiles) = 1, 'a user sees exactly one profile');
select tests.check(
  (select id from public.profiles) = (select id from ids where name = 'ali'),
  'and it is their own');
select tests.check(
  not exists (select 1 from public.profiles where phone = '+905321234567'),
  'another user''s phone number is not visible');

select tests.check(
  tests.row_count(format('update public.profiles set display_name = %L where id = %L',
    'hacked', (select id from ids where name = 'sara'))) = 0,
  'cannot update someone else''s profile');

select tests.check(
  tests.row_count(format('update public.profiles set display_name = %L, language = %L where id = %L',
    'Ali', 'en', (select id from ids where name = 'ali'))) = 1,
  'can update own name and language');

select tests.check_fails(
  format('update public.profiles set phone = %L where id = %L', '+15550000000', (select id from ids where name = 'ali')),
  'cannot change own phone (it comes from verified sign-in)');

select tests.check_fails(
  format('update public.profiles set email = %L where id = %L', 'x@example.com', (select id from ids where name = 'ali')),
  'cannot change own email');

select tests.check_fails(
  format('update public.profiles set default_currency = %L where id = %L', 'dollars', (select id from ids where name = 'ali')),
  'currency must be an ISO 4217 code');

select tests.check_fails(
  format('update public.profiles set avatar_path = %L where id = %L',
    (select id from ids where name = 'sara') || '/avatar.jpg', (select id from ids where name = 'ali')),
  'avatar path must be inside own folder');

select tests.check_fails(
  'insert into public.profiles (id) values (gen_random_uuid())',
  'cannot insert profiles directly');

select tests.check_fails(
  format('delete from public.profiles where id = %L', (select id from ids where name = 'ali')),
  'cannot delete profiles directly');

-- Avatars ---------------------------------------------------------------------
select tests.check(
  tests.row_count(format('insert into storage.objects (bucket_id, name) values (%L, %L)',
    'avatars', (select id from ids where name = 'ali') || '/avatar.jpg')) = 1,
  'can upload an avatar into own folder');

select tests.check_fails(
  format('insert into storage.objects (bucket_id, name) values (%L, %L)',
    'avatars', (select id from ids where name = 'sara') || '/avatar.jpg'),
  'cannot upload into someone else''s folder');

-- Anonymous visitors ----------------------------------------------------------
select tests.as_anon();
select tests.check_fails('select count(*) from public.profiles', 'anonymous visitors cannot read profiles');
select tests.check(
  (select count(*) from storage.objects where bucket_id = 'avatars') = 0,
  'anonymous visitors cannot see avatars');

-- Contact changes and account deletion ----------------------------------------
select tests.as_admin();
update auth.users set phone = '+905329999999' where id = (select id from ids where name = 'sara');
select tests.check(
  (select phone from public.profiles where id = (select id from ids where name = 'sara')) = '+905329999999',
  'verified phone change is mirrored to the profile');

delete from auth.users where id = (select id from ids where name = 'sara');
select tests.check(
  not exists (select 1 from public.profiles where id = (select id from ids where name = 'sara')),
  'deleting the account deletes the profile');

rollback;
