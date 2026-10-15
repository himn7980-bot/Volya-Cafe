-- Repayments, reminders and the notification queue.
begin;

create temp table ids (name text primary key, id uuid) on commit drop;
grant all on ids to anon, authenticated, service_role;
insert into ids values
  ('ali',  tests.new_user('ali@example.com', null, '{"language":"fa"}')),
  ('sara', tests.new_user('sara@example.com', null, '{"language":"tr"}')),
  ('omid', tests.new_user('omid@example.com')),
  ('l1', '00000000-0000-4000-8000-0000000000b1'),  -- Ali lent Sara 1000 USD (Sara linked)
  ('l2', '00000000-0000-4000-8000-0000000000b2'),  -- Ali borrowed 500 from Omid (Omid has no account link)
  ('r1', '00000000-0000-4000-8000-0000000000c1'),
  ('r2', '00000000-0000-4000-8000-0000000000c2'),
  ('r3', '00000000-0000-4000-8000-0000000000c3'),
  ('r4', '00000000-0000-4000-8000-0000000000c4');
update public.profiles set display_name = 'Ali' where id = (select id from ids where name = 'ali');
update public.profiles set display_name = 'Sara' where id = (select id from ids where name = 'sara');

create or replace function pg_temp.id(n text) returns uuid language sql as $$ select id from ids where name = n $$;
create or replace function pg_temp.loan(n text) returns public.loans language sql security definer as $$
  select * from public.loans where id = pg_temp.id(n) $$;
create or replace function pg_temp.rep_status(n text) returns text language sql security definer as $$
  select status from public.repayments where id = pg_temp.id(n) $$;
create or replace function pg_temp.notes(n text) returns text[] language sql security definer as $$
  select coalesce(array_agg(kind order by id), '{}') from public.notifications where user_id = pg_temp.id(n) $$;
create or replace function pg_temp.last_note(n text, k text) returns jsonb language sql security definer as $$
  select data from public.notifications where user_id = pg_temp.id(n) and kind = k order by id desc limit 1 $$;
create or replace function pg_temp.as_ip(ip text) returns void language sql as $$
  select set_config('request.headers', json_build_object('x-forwarded-for', ip)::text, true) $$;

select tests.as_user(pg_temp.id('ali'));
insert into public.loans (id, lender_id, counterparty_name, amount_minor, currency, auto_remind, due_date)
values (pg_temp.id('l1'), pg_temp.id('ali'), 'Sara joon', 100000, 'USD', true, current_date);
insert into public.loans (id, borrower_id, counterparty_name, amount_minor, currency)
values (pg_temp.id('l2'), pg_temp.id('ali'), 'Omid', 50000, 'USD');

select tests.check_fails(
  format('insert into public.repayments (id, loan_id, amount_minor) values (%L, %L, 100)', pg_temp.id('r1'), pg_temp.id('l1')),
  'no repayments before the record is confirmed');

-- Sara gets linked and confirms; Omid confirms through the link.
select tests.as_admin();
set local iou.internal_change = 'on';
update public.loans set borrower_id = pg_temp.id('sara') where id = pg_temp.id('l1');
reset iou.internal_change;
select tests.as_user(pg_temp.id('sara'));
select public.respond_to_loan(pg_temp.id('l1'), 'confirm', null);
select tests.as_anon();
select pg_temp.as_ip('2.2.2.2');
select public.respond_shared_loan((pg_temp.loan('l2')).share_token, 'confirm', null, 1);

select tests.check(pg_temp.notes('ali') = '{loan_confirmed,loan_confirmed}', 'the creator is notified of both confirmations');

-- Repayments ------------------------------------------------------------------------
-- Sara (borrower) says she paid back 300: Ali must confirm.
select tests.as_user(pg_temp.id('sara'));
insert into public.repayments (id, loan_id, amount_minor, note) values (pg_temp.id('r1'), pg_temp.id('l1'), 30000, 'cash');
select tests.check(pg_temp.rep_status('r1') = 'pending', 'a repayment from the borrower waits for the lender');
select tests.check(pg_temp.notes('ali') = '{loan_confirmed,loan_confirmed,repayment_new}', 'the lender is asked to confirm it');
select tests.check_fails(
  format($$update public.repayments set status = 'confirmed' where id = %L$$, pg_temp.id('r1')),
  'the borrower cannot confirm her own repayment');
select tests.check_fails(
  format('select public.respond_to_repayment(%L, %L, null)', pg_temp.id('r1'), 'confirm'),
  '...not even through the function');
select tests.check_fails(
  format('insert into public.repayments (loan_id, amount_minor) values (%L, 80000)', pg_temp.id('l1')),
  'cannot repay more than is still open (counting pending repayments)');

select tests.as_user(pg_temp.id('omid'));
select tests.check_fails(
  format('insert into public.repayments (loan_id, amount_minor) values (%L, 10)', pg_temp.id('l1')),
  'outsiders cannot add repayments');
select tests.check((select count(*) from public.repayments) = 0, 'outsiders cannot see repayments');

select tests.as_user(pg_temp.id('ali'));
select tests.check(public.respond_to_repayment(pg_temp.id('r1'), 'confirm', null) = 'confirmed', 'the lender confirms');
select tests.check(pg_temp.notes('sara') @> '{repayment_confirmed}', 'the borrower hears about it');
select tests.check_fails(
  format('update public.loans set amount_minor = 20000 where id = %L', pg_temp.id('l1')),
  'the amount cannot go below what was paid back');

-- Ali (lender) records 500 he received: confirmed straight away.
insert into public.repayments (id, loan_id, amount_minor) values (pg_temp.id('r2'), pg_temp.id('l1'), 50000);
select tests.check(pg_temp.rep_status('r2') = 'confirmed', 'a repayment recorded by the lender needs no confirmation');
select tests.check(pg_temp.notes('sara') @> '{repayment_recorded}', 'the borrower is told');
select tests.check((pg_temp.loan('l1')).status = 'confirmed', 'still open: 200 left');

-- Sara records the last 200, then disputes are possible too
select tests.as_user(pg_temp.id('sara'));
insert into public.repayments (id, loan_id, amount_minor) values (pg_temp.id('r3'), pg_temp.id('l1'), 20000);
select tests.as_user(pg_temp.id('ali'));
select tests.check_fails(
  format('select public.respond_to_repayment(%L, %L, %L)', pg_temp.id('r3'), 'dispute', ' '),
  'a disputed repayment needs a comment');
select tests.check(
  public.respond_to_repayment(pg_temp.id('r3'), 'dispute', 'I only got 100') = 'disputed',
  'the lender can dispute a repayment');
select tests.check(
  (select count(*) = 1 from public.disputes where repayment_id = pg_temp.id('r3')),
  'the dispute is stored');
select tests.as_user(pg_temp.id('sara'));
insert into public.repayments (id, loan_id, amount_minor) values (pg_temp.id('r4'), pg_temp.id('l1'), 20000);
select tests.check(
  tests.row_count(format($$update public.repayments set status = 'cancelled' where id = %L$$, pg_temp.id('r4'))) = 1,
  'the borrower can withdraw her own pending repayment');
insert into public.repayments (loan_id, amount_minor) values (pg_temp.id('l1'), 20000);
select tests.as_user(pg_temp.id('ali'));
select public.respond_to_repayment((select id from public.repayments where loan_id = pg_temp.id('l1') and status = 'pending'), 'confirm', null);
select tests.check((pg_temp.loan('l1')).status = 'settled', 'fully paid back: the record is settled');
select tests.check(
  (select snapshot ->> 'status' = 'settled' from public.loan_versions where loan_id = pg_temp.id('l1') order by version desc limit 1),
  'settling is part of the history');
select tests.check(pg_temp.notes('sara') @> '{settled}', 'the borrower hears it is settled');
select tests.check_fails(
  format('insert into public.repayments (loan_id, amount_minor) values (%L, 1)', pg_temp.id('l1')),
  'nothing can be added to a settled record');

-- Repayment to a lender without an account, answered through the link
select tests.as_user(pg_temp.id('ali'));
insert into public.repayments (id, loan_id, amount_minor) values (gen_random_uuid(), pg_temp.id('l2'), 20000);
select tests.as_anon();
select pg_temp.as_ip('3.3.3.3');
select tests.check(
  (select r ->> 'open' = 'true' and jsonb_array_length(r -> 'repayments') = 1 and (r ->> 'repaid_minor')::int = 0
   from public.get_shared_loan((pg_temp.loan('l2')).share_token) r),
  'the link reopens so Omid can confirm the repayment');
select tests.check(
  (select r ->> 'status' = 'confirmed'
   from public.get_shared_loan((pg_temp.loan('l2')).share_token) g,
        lateral public.respond_shared_repayment((pg_temp.loan('l2')).share_token, (g -> 'repayments' -> 0 ->> 'id')::uuid, 'confirm', null) r),
  'Omid confirms the repayment through the link');
select tests.check(
  (select r ->> 'open' = 'false' from public.get_shared_loan((pg_temp.loan('l2')).share_token) r),
  'and the link closes again');

-- The link cannot be used to answer repayments for a lender who has an account
select tests.check(
  (select r ->> 'error' = 'closed' from public.respond_shared_repayment((pg_temp.loan('l1')).share_token, pg_temp.id('r3'), 'confirm', null) r),
  'link answers only for lenders without an account');

-- Reminders ----------------------------------------------------------------------------
create temp table l3 as select gen_random_uuid() as id;
grant all on l3 to authenticated;
select tests.as_user(pg_temp.id('ali'));
insert into public.loans (id, lender_id, counterparty_name, amount_minor, currency) select id, pg_temp.id('ali'), 'Sara', 1000, 'EUR' from l3;
select tests.as_admin();
set local iou.internal_change = 'on';
update public.loans set borrower_id = pg_temp.id('sara'), status = 'confirmed' where id = (select id from l3);
reset iou.internal_change;

select tests.as_user(pg_temp.id('sara'));
select tests.check_fails(
  format('select public.send_reminder(%L, %L, %L)', (select id from l3), 'gentle', 'push'),
  'only the lender sends reminders');

select tests.as_user(pg_temp.id('ali'));
select tests.check(
  (select r ->> 'ok' = 'true' from public.send_reminder((select id from l3), 'gentle', 'push') r),
  'the lender sends a gentle reminder');
select tests.check(
  (select d ->> 'tone' = 'gentle' and d ->> 'greet_name' = 'Sara' and d ->> 'name' = 'Ali'
   from pg_temp.last_note('sara', 'reminder') d),
  'the borrower gets it, with both names right');
select tests.check(
  (select r ->> 'error' = 'too_soon' and (r ->> 'next_at')::timestamptz > now() + interval '47 hours'
   from public.send_reminder((select id from l3), 'firm', 'share') r),
  'a second reminder within 48 hours is refused, on any channel');
select tests.check_fails(
  format('select public.send_reminder(%L, %L, %L)', pg_temp.id('l2'), 'gentle', 'push'),
  'Ali is the borrower of l2, so he cannot send reminders there');
select tests.check_fails('insert into public.reminders (loan_id, tone, channel) select id, ''gentle'', ''push'' from l3', 'reminders cannot be written directly');

-- Due-date job (l1 is settled, so nothing is due today)
select tests.as_admin();
select tests.check(public.run_due_reminders() = 0, 'settled records get no due reminders');
set local iou.internal_change = 'on';
update public.loans set auto_remind = true, due_date = current_date where id = (select id from l3);
reset iou.internal_change;
select tests.check(public.run_due_reminders() = 1, 'an open record due today with auto reminders is reminded');
select tests.check(public.run_due_reminders() = 0, '...once per day');
select tests.check(pg_temp.notes('ali') @> '{due_today}', 'the lender is told it is due');

-- Notification queue and push tokens ------------------------------------------------------
select tests.as_user(pg_temp.id('sara'));
select public.register_push_token('ExponentPushToken[sara-phone]', 'android');
select tests.check_fails('select * from public.notifications', 'nobody reads the queue from the app');
select tests.check_fails('select public.claim_notifications(10)', 'only the server sends notifications');
select tests.as_user(pg_temp.id('omid'));
select tests.check((select count(*) from public.push_tokens) = 0, 'push tokens are private');
-- The phone changes hands
select public.register_push_token('ExponentPushToken[sara-phone]', 'android');
select tests.as_admin();
select tests.check(
  (select user_id = pg_temp.id('omid') from public.push_tokens where token = 'ExponentPushToken[sara-phone]'),
  'a token belongs to whoever signed in last on that phone');
update public.push_tokens set user_id = pg_temp.id('sara');

set local role service_role;
create temp table batch as select public.claim_notifications(500) as b;
select tests.check(
  (select bool_and(e ->> 'language' = 'tr' and e -> 'tokens' = '["ExponentPushToken[sara-phone]"]')
   from batch, jsonb_array_elements(b) e where e -> 'data' ->> 'greet_name' = 'Sara'),
  'the server gets each notification with the recipient''s language and phones');
select public.complete_notifications(
  (select array_agg((e ->> 'id')::bigint) from batch, jsonb_array_elements(b) e), '{}'::jsonb, array['ExponentPushToken[sara-phone]']);
select tests.check((select count(*) from public.notifications where sent_at is null) = 0, 'sent notifications are marked');
select tests.check((select count(*) from public.push_tokens) = 0, 'dead tokens are removed');
reset role;

rollback;
