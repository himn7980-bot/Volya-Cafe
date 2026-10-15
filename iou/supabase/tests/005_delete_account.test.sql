-- Deleting an account (what the delete-account Edge Function does after
-- removing the files): records the person wrote disappear, records the other
-- side wrote stay for them with the link to this person removed.
begin;

create temp table ids (name text primary key, id uuid) on commit drop;
grant all on ids to anon, authenticated, service_role;
insert into ids values
  ('ali',  tests.new_user('ali@example.com')),
  ('sara', tests.new_user('sara@example.com')),
  ('l1', '00000000-0000-4000-8000-0000000000d1'),  -- Ali lent Sara (written by Ali)
  ('l2', '00000000-0000-4000-8000-0000000000d2'),  -- Sara lent Ali (written by Sara)
  ('r1', '00000000-0000-4000-8000-0000000000e1');
update public.profiles set display_name = 'Ali' where id = (select id from ids where name = 'ali');
update public.profiles set display_name = 'Sara' where id = (select id from ids where name = 'sara');

create or replace function pg_temp.id(n text) returns uuid language sql as $$ select id from ids where name = n $$;
create or replace function pg_temp.loan(n text) returns public.loans language sql security definer as $$
  select * from public.loans where id = pg_temp.id(n) $$;

select tests.as_user(pg_temp.id('ali'));
insert into public.loans (id, lender_id, counterparty_name, amount_minor, currency)
values (pg_temp.id('l1'), pg_temp.id('ali'), 'Sara', 10000, 'USD');
select tests.as_user(pg_temp.id('sara'));
insert into public.loans (id, lender_id, counterparty_name, amount_minor, currency)
values (pg_temp.id('l2'), pg_temp.id('sara'), 'Ali', 20000, 'EUR');

-- Link both sides and confirm, then Ali records a repayment on Sara's record.
select tests.as_admin();
set local iou.internal_change = 'on';
update public.loans set borrower_id = pg_temp.id('sara') where id = pg_temp.id('l1');
update public.loans set borrower_id = pg_temp.id('ali') where id = pg_temp.id('l2');
reset iou.internal_change;
select tests.as_user(pg_temp.id('ali'));
select public.respond_to_loan(pg_temp.id('l2'), 'confirm', null);
insert into public.repayments (id, loan_id, amount_minor) values (pg_temp.id('r1'), pg_temp.id('l2'), 5000);
select public.register_push_token('ExponentPushToken[ali]', 'ios');

-- Delete Ali's account the way the admin API does.
select tests.as_admin();
delete from auth.users where id = pg_temp.id('ali');

select tests.check(not exists (select 1 from public.profiles where id = pg_temp.id('ali')), 'the profile is gone');
select tests.check(pg_temp.loan('l1') is null, 'records Ali wrote are gone');
select tests.check((select count(*) from public.loan_versions where loan_id = pg_temp.id('l1')) = 0, 'and their history');
select tests.check((pg_temp.loan('l2')).borrower_id is null, 'Sara keeps her record without the link to Ali');
select tests.check((pg_temp.loan('l2')).status = 'confirmed', 'its status does not change');
select tests.check(
  (select created_by from public.repayments where id = pg_temp.id('r1')) is null
  and (select status from public.repayments where id = pg_temp.id('r1')) = 'pending',
  'the repayment Ali recorded stays, without his id');
select tests.check(not exists (select 1 from public.push_tokens where token = 'ExponentPushToken[ali]'), 'push tokens are gone');
select tests.check(not exists (select 1 from public.notifications where user_id = pg_temp.id('ali')), 'queued notifications are gone');

select tests.as_user(pg_temp.id('sara'));
select tests.check((select count(*) from public.loans) = 1, 'Sara still sees her own record');

rollback;
