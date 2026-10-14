-- Test helpers shared by every *.test.sql file. Works on a real Supabase
-- database (local `supabase start`) and on the plain-Postgres shim.

create schema if not exists tests;

-- Act as a signed-in user for the rest of the transaction.
create or replace function tests.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- Act as a visitor with no account (the public web page uses this role).
create or replace function tests.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end $$;

create or replace function tests.as_admin() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'reset role';
end $$;

create or replace function tests.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then
    raise exception 'FAILED: %', what;
  end if;
  raise notice 'ok - %', what;
end $$;

-- Run a statement and require it to fail (permission or RLS error).
create or replace function tests.check_fails(stmt text, what text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok - % (%)', what, sqlerrm;
    return;
  end;
  raise exception 'FAILED: % (statement succeeded: %)', what, stmt;
end $$;

-- Run a statement and return how many rows it touched.
create or replace function tests.row_count(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

create or replace function tests.new_user(email text default null, phone text default null, meta jsonb default '{}')
returns uuid language sql as $$
  insert into auth.users (id, email, phone, raw_user_meta_data)
  values (gen_random_uuid(), email, phone, meta)
  returning id
$$;
