-- Share links: the public page, answers in the app, linking accounts, rate limits.
begin;

create temp table ids (name text primary key, id uuid) on commit drop;
grant all on ids to anon, authenticated;
insert into ids values
  ('ali',  tests.new_user('ali@example.com', null, '{"language":"fa"}')),
  ('sara', tests.new_user(null, '+905321234567', '{"language":"tr"}')),
  ('omid', tests.new_user('omid@example.com')),
  ('l1', '00000000-0000-4000-8000-0000000000a1'),
  ('l2', '00000000-0000-4000-8000-0000000000a2'),
  ('l3', '00000000-0000-4000-8000-0000000000a3');
update public.profiles set display_name = 'Ali' where id = (select id from ids where name = 'ali');

create or replace function pg_temp.id(n text) returns uuid language sql as $$ select id from ids where name = n $$;
create or replace function pg_temp.token(n text) returns text language sql security definer as $$
  select share_token from public.loans where id = pg_temp.id(n) $$;
create or replace function pg_temp.status(n text) returns text language sql security definer as $$
  select status from public.loans where id = pg_temp.id(n) $$;
create or replace function pg_temp.as_ip(ip text) returns void language sql as $$
  select set_config('request.headers', json_build_object('x-forwarded-for', ip || ', 10.0.0.1')::text, true) $$;

-- Ali lends Sara 500,000 toman and borrows $20 from Omid.
select tests.as_user(pg_temp.id('ali'));
insert into public.loans (id, lender_id, counterparty_name, counterparty_phone, amount_minor, currency, note)
values (pg_temp.id('l1'), pg_temp.id('ali'), 'Sara', '+905321234567', 5000000, 'IRR', 'rent');
insert into public.loans (id, borrower_id, counterparty_name, amount_minor, currency)
values (pg_temp.id('l2'), pg_temp.id('ali'), 'Omid', 2000, 'USD');
insert into public.loans (id, lender_id, counterparty_name, amount_minor, currency)
values (pg_temp.id('l3'), pg_temp.id('ali'), 'Someone', 100, 'USD');

-- The public page ---------------------------------------------------------------
select tests.as_anon();
select pg_temp.as_ip('1.1.1.1');

select tests.check(
  (select r ->> 'open' = 'true' and r ->> 'creator_name' = 'Ali' and r ->> 'creator_role' = 'lender'
     and (r ->> 'amount_minor')::bigint = 5000000 and r ->> 'language' = 'fa' and r ->> 'note' = 'rent'
   from public.get_shared_loan(pg_temp.token('l1')) r),
  'anyone with the link sees the record and who wrote it');
select tests.check(
  (select not (r::text ilike '%+90532%') and not (r ? 'counterparty_phone') and not (r ? 'share_token')
   from public.get_shared_loan(pg_temp.token('l1')) r),
  'the public page never gets phone numbers');
select tests.check(
  (select r ->> 'error' = 'not_found' from public.get_shared_loan(repeat('0', 64)) r),
  'a wrong token finds nothing');
select tests.check_fails('select * from public.loans', 'anonymous visitors still cannot read the table');

select tests.check(
  (select r ->> 'error' = 'invalid' from public.respond_shared_loan(pg_temp.token('l1'), 'dispute', '   ', 1) r),
  'a dispute needs a comment');
select tests.check(
  (select r ->> 'error' = 'changed' from public.respond_shared_loan(pg_temp.token('l1'), 'confirm', null, 99) r),
  'cannot confirm a version you did not see');

select tests.check(
  (select r ->> 'status' = 'disputed' from public.respond_shared_loan(pg_temp.token('l1'), 'dispute', 'It was 400,000', 1) r),
  'the other person can dispute with a comment');
select tests.check(
  (select r ->> 'dispute_comment' = 'It was 400,000' and r ->> 'open' = 'true' from public.get_shared_loan(pg_temp.token('l1')) r),
  'the page shows the dispute and still accepts a confirmation');

-- Ali fixes the amount: back to pending, and Sara confirms the new version.
select tests.as_user(pg_temp.id('ali'));
update public.loans set amount_minor = 4000000 where id = pg_temp.id('l1');
select tests.check(pg_temp.status('l1') = 'pending', 'fixing a disputed record asks again');

select tests.as_anon();
select pg_temp.as_ip('1.1.1.1');
select tests.check(
  (select r ->> 'status' = 'confirmed' from public.respond_shared_loan(pg_temp.token('l1'), 'confirm', null, 3) r), -- v1 created, v2 disputed, v3 fixed
  'the other person confirms through the link');
select tests.check(
  (select r ->> 'open' = 'false' and not (r ? 'amount_minor') from public.get_shared_loan(pg_temp.token('l1')) r),
  'after confirmation the link stops showing the record');
select tests.check(
  (select r ->> 'error' = 'closed' from public.respond_shared_loan(pg_temp.token('l1'), 'dispute', 'changed my mind', 5) r),
  'and stops accepting answers');

-- History shows who did what
select tests.as_user(pg_temp.id('ali'));
select tests.check(
  (select changed_by is null and snapshot ->> 'status' = 'disputed' and snapshot ->> 'comment' = 'It was 400,000'
   from public.loan_versions where loan_id = pg_temp.id('l1') and version = 2),
  'answers through the link are recorded without an account, with the comment');
select tests.check(
  (select count(*) = 1 from public.disputes where loan_id = pg_temp.id('l1')),
  'the dispute is stored and visible to the creator');
select tests.check(
  (select not (snapshot ? 'share_token') and not (snapshot ? 'share_expires_at') from public.loan_versions where loan_id = pg_temp.id('l1') and version = 4),
  'history never stores the token');

-- Expiry --------------------------------------------------------------------------
select tests.as_admin();
set local iou.internal_change = 'on';
update public.loans set share_expires_at = now() - interval '1 minute' where id = pg_temp.id('l3');
reset iou.internal_change;
select tests.as_anon();
select pg_temp.as_ip('1.1.1.1');
select tests.check(
  (select r ->> 'open' = 'false' from public.get_shared_loan(pg_temp.token('l3')) r),
  'links expire after 30 days');

-- Linking accounts ---------------------------------------------------------------------
-- Sara signs up with the phone number Ali entered: the record becomes hers too.
select tests.as_user(pg_temp.id('sara'));
select tests.check(public.claim_loans_by_phone() = 1, 'signing up with the entered phone links the record');
select tests.check(
  (select borrower_id = pg_temp.id('sara') from public.loans where id = pg_temp.id('l1')),
  'she becomes the borrower');
select tests.check(
  (select count(*) = 1 and bool_and(display_name = 'Ali' and language = 'fa') from public.my_counterparts()),
  'she sees the other person''s name and language');
select tests.check(
  (select not exists (select 1 from public.my_counterparts() where id = pg_temp.id('omid'))),
  '...but nobody she does not share a record with');

-- Omid opens Ali's link with the app installed.
select tests.as_user(pg_temp.id('omid'));
select tests.check(public.claim_shared_loan(pg_temp.token('l2')) = pg_temp.id('l2'), 'opening the link in the app links the record');
select tests.check(
  (select lender_id = pg_temp.id('omid') from public.loans where id = pg_temp.id('l2')),
  'Omid becomes the lender');
select tests.check(public.claim_shared_loan(pg_temp.token('l2')) = pg_temp.id('l2'), 'claiming twice is harmless');

select tests.as_user(pg_temp.id('sara'));
select tests.check_fails(
  format('select public.claim_shared_loan(%L)', pg_temp.token('l2')),
  'a record with both parties cannot be claimed by a third person');

-- Answering in the app
select tests.as_user(pg_temp.id('ali'));
select tests.check_fails(
  format('select public.respond_to_loan(%L, %L, null)', pg_temp.id('l2'), 'confirm'),
  'the creator cannot confirm their own record');
select tests.as_user(pg_temp.id('sara'));
select tests.check_fails(
  format('select public.respond_to_loan(%L, %L, null)', pg_temp.id('l2'), 'confirm'),
  'an outsider cannot confirm');
select tests.as_user(pg_temp.id('omid'));
select tests.check(public.respond_to_loan(pg_temp.id('l2'), 'confirm', null) = 'confirmed', 'the other party confirms in the app');
select tests.check(
  (select changed_by = pg_temp.id('omid') from public.loan_versions where loan_id = pg_temp.id('l2') order by version desc limit 1),
  'the history shows who confirmed');

-- Anonymous visitors cannot use the account functions
select tests.as_anon();
select tests.check_fails(format('select public.claim_shared_loan(%L)', pg_temp.token('l3')), 'claiming needs an account');
select tests.check_fails('select * from public.my_counterparts()', 'counterpart names need an account');
select tests.check_fails($$select public.rate_limit_hit('x', 1, 1)$$, 'the rate limiter is internal');

-- Rate limiting ------------------------------------------------------------------------
select pg_temp.as_ip('6.6.6.6');
select tests.check(
  (select count(*) from generate_series(1, 25) i,
     lateral public.get_shared_loan(md5(i::text) || md5('x' || i)) r
   where r ->> 'error' = 'rate_limited') = 5,
  'guessing tokens is cut off after 20 misses per hour');
select tests.check(
  (select r ->> 'error' = 'rate_limited' from public.get_shared_loan(pg_temp.token('l3')) r) is not true,
  'other IP addresses are not affected');

rollback;
