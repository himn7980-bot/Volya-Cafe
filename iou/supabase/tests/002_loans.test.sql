-- Loans: who can see and change what, versioning and re-confirmation.
begin;

create temp table ids (name text primary key, id uuid) on commit drop;
grant all on ids to anon, authenticated;
insert into ids values
  ('ali',  tests.new_user('ali@example.com')),
  ('sara', tests.new_user('sara@example.com')),
  ('omid', tests.new_user('omid@example.com')),
  ('loan', '00000000-0000-4000-8000-000000000001'),
  ('loan2', '00000000-0000-4000-8000-000000000002');

create or replace function pg_temp.id(n text) returns uuid language sql as $$ select id from ids where name = n $$;

-- Creating ---------------------------------------------------------------------
select tests.as_user(pg_temp.id('ali'));

insert into public.loans (id, lender_id, counterparty_name, counterparty_phone, amount_minor, currency, note, loan_date)
values (pg_temp.id('loan'), pg_temp.id('ali'), '  Sara  ', '+905321234567', 5000000, 'IRR', 'For the rent', '2026-10-01');

select tests.check(
  (select status = 'pending' and version = 1 and creator_id = pg_temp.id('ali')
     and counterparty_name = 'Sara' and length(share_token) = 64
   from public.loans where id = pg_temp.id('loan')),
  'new loan is pending, version 1, with a 64-char share token and trimmed name');
select tests.check(
  (select count(*) from public.loan_versions where loan_id = pg_temp.id('loan')) = 1,
  'creating a loan records version 1');
select tests.check(
  (select not (snapshot ? 'share_token') from public.loan_versions where loan_id = pg_temp.id('loan')),
  'history snapshots never contain the share token');

select tests.check_fails(
  format('insert into public.loans (lender_id, counterparty_name, amount_minor, currency) values (%L, %L, 100, %L)',
    pg_temp.id('sara'), 'x', 'USD'),
  'cannot create a loan where someone else is the lender');
select tests.check_fails(
  format('insert into public.loans (lender_id, borrower_id, counterparty_name, amount_minor, currency) values (%L, %L, %L, 100, %L)',
    pg_temp.id('ali'), pg_temp.id('sara'), 'x', 'USD'),
  'cannot attach the other person when creating');
select tests.check_fails(
  $$insert into public.loans (counterparty_name, amount_minor, currency) values ('x', 100, 'USD')$$,
  'creator must be the lender or the borrower');
select tests.check_fails(
  format($$insert into public.loans (lender_id, counterparty_name, amount_minor, currency, status) values (%L, 'x', 100, 'USD', 'confirmed')$$,
    pg_temp.id('ali')),
  'cannot create an already-confirmed loan');
select tests.check_fails(
  format($$insert into public.loans (lender_id, counterparty_name, amount_minor, currency) values (%L, 'x', 0, 'USD')$$, pg_temp.id('ali')),
  'amount must be positive');
select tests.check_fails(
  format($$insert into public.loans (lender_id, counterparty_name, amount_minor, currency) values (%L, 'x', 10, 'dollar')$$, pg_temp.id('ali')),
  'currency must be an ISO code');
select tests.check_fails(
  format($$insert into public.loans (lender_id, counterparty_name, amount_minor, currency, loan_date, due_date) values (%L, 'x', 10, 'USD', '2026-10-10', '2026-10-01')$$, pg_temp.id('ali')),
  'due date cannot be before the loan date');
select tests.check_fails(
  format($$insert into public.loans (lender_id, counterparty_name, counterparty_phone, amount_minor, currency) values (%L, 'x', '0912', 10, 'USD')$$, pg_temp.id('ali')),
  'phone must be E.164');

-- Borrower-side record
insert into public.loans (id, borrower_id, counterparty_name, amount_minor, currency)
values (pg_temp.id('loan2'), pg_temp.id('ali'), 'Omid', 2000, 'USD');
select tests.check(
  (select borrower_id = pg_temp.id('ali') and lender_id is null from public.loans where id = pg_temp.id('loan2')),
  'can record money I borrowed');

-- Privacy -----------------------------------------------------------------------
select tests.as_user(pg_temp.id('sara'));
select tests.check((select count(*) from public.loans) = 0, 'the other person cannot see a loan before they are linked to it');
select tests.check((select count(*) from public.loan_versions) = 0, '...nor its history');
select tests.check(
  tests.row_count(format('update public.loans set amount_minor = 1 where id = %L', pg_temp.id('loan'))) = 0,
  'a stranger cannot edit the loan');

select tests.as_anon();
select tests.check_fails('select count(*) from public.loans', 'anonymous visitors cannot read loans');

-- Editing and versions -------------------------------------------------------------
select tests.as_user(pg_temp.id('ali'));

update public.loans set amount_minor = 6000000 where id = pg_temp.id('loan');
select tests.check(
  (select version = 2 and status = 'pending' from public.loans where id = pg_temp.id('loan')),
  'editing bumps the version');
select tests.check(
  (select (snapshot ->> 'amount_minor')::bigint = 5000000 from public.loan_versions where loan_id = pg_temp.id('loan') and version = 1),
  'the previous version is kept unchanged');

update public.loans set note = note where id = pg_temp.id('loan');
select tests.check((select version from public.loans where id = pg_temp.id('loan')) = 2, 'a no-op update does not create a version');

select tests.check_fails(
  format($$update public.loans set status = 'confirmed' where id = %L$$, pg_temp.id('loan')),
  'the creator cannot confirm their own loan');
select tests.check_fails(
  format($$update public.loans set status = 'settled' where id = %L$$, pg_temp.id('loan')),
  'the app cannot mark a loan settled directly');
select tests.check_fails(
  format($$update public.loans set share_token = 'x' where id = %L$$, pg_temp.id('loan')),
  'share token cannot be changed');
select tests.check_fails(
  format($$update public.loans set borrower_id = %L where id = %L$$, pg_temp.id('sara'), pg_temp.id('loan')),
  'parties cannot be changed by the app');
select tests.check_fails(
  format($$delete from public.loans where id = %L$$, pg_temp.id('loan')),
  'loans cannot be deleted');
select tests.check_fails(
  format($$update public.loan_versions set snapshot = '{}' where loan_id = %L$$, pg_temp.id('loan')),
  'history cannot be rewritten');
select tests.check_fails(
  format($$delete from public.loan_versions where loan_id = %L$$, pg_temp.id('loan')),
  'history cannot be deleted');
select tests.check_fails(
  format($$insert into public.loan_versions (loan_id, version, snapshot) values (%L, 99, '{}')$$, pg_temp.id('loan')),
  'history cannot be forged');

-- Sara is linked and confirms (done by server functions in phase 3; simulated here).
select tests.as_admin();
set local iou.internal_change = 'on';
update public.loans set borrower_id = pg_temp.id('sara'), status = 'confirmed' where id = pg_temp.id('loan');
reset iou.internal_change;

select tests.as_user(pg_temp.id('sara'));
select tests.check((select count(*) from public.loans) = 1, 'once linked, the other person sees the loan');
select tests.check((select count(*) from public.loan_versions) = 3, '...and its full history');
select tests.check(
  tests.row_count(format('update public.loans set amount_minor = 1 where id = %L', pg_temp.id('loan'))) = 0,
  'only the creator can edit');

select tests.as_user(pg_temp.id('ali'));
update public.loans set counterparty_name = 'Sara joon' where id = pg_temp.id('loan');
select tests.check(
  (select status from public.loans where id = pg_temp.id('loan')) = 'confirmed',
  'renaming the other person does not need re-confirmation');

update public.loans set amount_minor = 7000000 where id = pg_temp.id('loan');
select tests.check(
  (select status = 'pending' and version = 5 from public.loans where id = pg_temp.id('loan')),
  'changing the amount after confirmation requires confirming again');

-- Photos ---------------------------------------------------------------------------
select tests.check(
  tests.row_count(format('insert into storage.objects (bucket_id, name) values (%L, %L)',
    'loan-photos', pg_temp.id('loan') || '/receipt.jpg')) = 1,
  'creator can upload a receipt photo');
update public.loans set photo_path = pg_temp.id('loan') || '/receipt.jpg' where id = pg_temp.id('loan');
select tests.check_fails(
  format('update public.loans set photo_path = %L where id = %L', pg_temp.id('loan2') || '/x.jpg', pg_temp.id('loan')),
  'photo must be in the loan''s own folder');

select tests.as_user(pg_temp.id('sara'));
select tests.check(
  (select count(*) from storage.objects where bucket_id = 'loan-photos') = 1,
  'the other party can see the photo');
select tests.check_fails(
  format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'loan-photos', pg_temp.id('loan') || '/fake.jpg'),
  'the other party cannot add photos');

select tests.as_user(pg_temp.id('omid'));
select tests.check(
  (select count(*) from storage.objects where bucket_id = 'loan-photos') = 0,
  'outsiders cannot see photos');

-- Cancelling ---------------------------------------------------------------------------
select tests.as_user(pg_temp.id('ali'));
update public.loans set status = 'cancelled' where id = pg_temp.id('loan2');
select tests.check(
  (select status = 'cancelled' and version = 2 from public.loans where id = pg_temp.id('loan2')),
  'creator can cancel; cancelling is a version too');
select tests.check_fails(
  format('update public.loans set amount_minor = 1 where id = %L', pg_temp.id('loan2')),
  'a cancelled loan cannot be edited');
select tests.check_fails(
  format($$update public.loans set status = 'pending' where id = %L$$, pg_temp.id('loan2')),
  'a cancelled loan cannot be reopened');

rollback;
