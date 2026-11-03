-- Trust score: extensions, lateness, freezing, anti-gaming weights and card access.
begin;

create temp table ids (name text primary key, id uuid) on commit drop;
grant all on ids to anon, authenticated;
insert into ids values
  ('ali',  tests.new_user('ali@example.com')),
  ('sara', tests.new_user('sara@example.com')),
  ('omid', tests.new_user('omid@example.com')),
  ('nima', tests.new_user('nima@example.com')),
  ('eve',  tests.new_user('eve@example.com'));

create or replace function pg_temp.id(n text) returns uuid language sql as $$ select id from ids where name = n $$;

-- A confirmed record between two accounts (admin, bypassing the normal flow).
create or replace function pg_temp.loan(lender text, borrower text, amount bigint, loan_date date, due date)
returns uuid language plpgsql as $$
declare lid uuid;
begin
  perform set_config('iou.internal_change', 'on', true);
  insert into public.loans (creator_id, lender_id, borrower_id, counterparty_name, amount_minor, currency, loan_date, due_date, status)
  values (pg_temp.id(lender), pg_temp.id(lender), pg_temp.id(borrower), 'x', amount, 'USD', loan_date, due, 'confirmed')
  returning id into lid;
  perform set_config('iou.internal_change', '', true);
  return lid;
end $$;

-- The lender records full repayment; pretend it was confirmed `after_days` from now.
create or replace function pg_temp.repay(lid uuid, paid date, after_days integer) returns void language plpgsql as $$
declare l public.loans;
begin
  select * into l from public.loans where id = lid;
  perform set_config('iou.internal_change', 'on', true);
  insert into public.repayments (loan_id, amount_minor, paid_on, created_by) values (lid, l.amount_minor, paid, l.lender_id);
  perform set_config('iou.internal_change', 'on', true); -- the insert trigger switched it off
  update public.repayments set responded_at = now() + make_interval(days => after_days) where loan_id = lid;
  perform set_config('iou.internal_change', '', true);
end $$;

create or replace function pg_temp.ev(lid uuid, who text, as_of date) returns record language sql as $$
  select (e.kind, e.late_days, e.points, e.weight)::record from public.trust_events(pg_temp.id(who), as_of) e where e.loan_id = lid
$$;

create temp table l (name text primary key, id uuid) on commit drop;
grant all on l to anon, authenticated;

select tests.as_admin();

-- 1. On time --------------------------------------------------------------------
insert into l values ('ontime', pg_temp.loan('ali', 'sara', 10000, current_date, current_date + 10));
select pg_temp.repay((select id from l where name = 'ontime'), current_date + 5, 5);
select tests.check(
  (select kind = 'on_time' and points > 0 from public.trust_events(pg_temp.id('sara'), current_date + 6)
   where loan_id = (select id from l where name = 'ontime')),
  'repaid before the due date is on time, positive');
select tests.check(
  (select kind = 'lent' and points > 0 from public.trust_events(pg_temp.id('ali'), current_date + 6)
   where loan_id = (select id from l where name = 'ontime')),
  'the lender gets a small positive for a settled loan');
select tests.check(
  not exists (select 1 from public.trust_events(pg_temp.id('sara'), current_date + 4)
              where loan_id = (select id from l where name = 'ontime')),
  'nothing counts before the repayment was confirmed');

-- 2. Late without agreement -------------------------------------------------------
insert into l values ('late', pg_temp.loan('omid', 'sara', 10000, current_date, current_date + 2));
select pg_temp.repay((select id from l where name = 'late'), current_date + 12, 12);
select tests.check(
  (select kind = 'late' and late_days = 10 and base_points = -14 and weight = 1 * power(0.5, 1.0 / 365)::numeric(10,4)
   from public.trust_events(pg_temp.id('sara'), current_date + 13)
   where loan_id = (select id from l where name = 'late')),
  '10 days late: -(5 + 9) base, only faded by age');

-- 3. Extension agreed before the due date -----------------------------------------
insert into l values ('ext_before', pg_temp.loan('nima', 'sara', 10000, current_date, current_date + 5));
select tests.as_user(pg_temp.id('sara'));
select tests.check_fails(
  format('select public.propose_extension(%L, %L, %L)', (select id from l where name = 'ext_before'), current_date + 3, 'x'),
  'the new date must be later than the current one');
select public.propose_extension((select id from l where name = 'ext_before'), current_date + 20, 'salary is late');
select tests.check_fails(
  format('select public.propose_extension(%L, %L, %L)', (select id from l where name = 'ext_before'), current_date + 25, 'x'),
  'only one waiting request per record');
select tests.check_fails(
  format('select public.respond_to_extension(%L, %L)', (select id from public.loan_extensions where status = 'pending'), 'accept'),
  'the proposer cannot accept their own request');
select tests.as_user(pg_temp.id('eve'));
select tests.check_fails(
  format('select public.respond_to_extension(%L, %L)', (select e.id from public.loan_extensions e limit 1), 'accept'),
  'a stranger cannot answer');
select tests.check((select count(*) from public.loan_extensions) = 0, 'a stranger cannot see extension requests');
select tests.as_user(pg_temp.id('nima'));
select tests.check(
  public.respond_to_extension((select id from public.loan_extensions where status = 'pending'), 'accept') = 'accepted',
  'the other person accepts');
select tests.check(
  (select due_date = current_date + 20 and status = 'confirmed' from public.loans where id = (select id from l where name = 'ext_before')),
  'accepting moves the due date and keeps the record confirmed');
select tests.as_admin();
select pg_temp.repay((select id from l where name = 'ext_before'), current_date + 15, 15);
select tests.check(
  (select kind = 'on_time' from public.trust_events(pg_temp.id('sara'), current_date + 16)
   where loan_id = (select id from l where name = 'ext_before')),
  'paid after the old date but before the agreed new one: on time');

-- 4. Extension agreed after the due date --------------------------------------------
insert into l values ('ext_after', pg_temp.loan('nima', 'omid', 10000, current_date - 10, current_date - 5));
select tests.as_user(pg_temp.id('omid'));
select public.propose_extension((select id from l where name = 'ext_after'), current_date + 10, '');
select tests.as_user(pg_temp.id('nima'));
select public.respond_to_extension((select id from public.loan_extensions where status = 'pending'), 'accept');
select tests.as_admin();
select pg_temp.repay((select id from l where name = 'ext_after'), current_date + 3, 3);
select tests.check(
  (select kind = 'late' and late_days = 5 from public.trust_events(pg_temp.id('omid'), current_date + 4)
   where loan_id = (select id from l where name = 'ext_after')),
  'agreed after the due date: the 5 days before the agreement still count');

-- 5. Overdue and frozen -------------------------------------------------------------
insert into l values ('overdue', pg_temp.loan('ali', 'omid', 10000, current_date - 10, current_date - 3));
select tests.check(
  (select kind = 'overdue' and late_days = 3 and base_points = -7 from public.trust_events(pg_temp.id('omid'), current_date)
   where loan_id = (select id from l where name = 'overdue')),
  'unpaid after the due date: overdue, penalty grows with the days');
select tests.as_user(pg_temp.id('omid'));
insert into public.repayments (loan_id, amount_minor, paid_on) values ((select id from l where name = 'overdue'), 10000, current_date);
select tests.as_admin();
select tests.check(
  not exists (select 1 from public.trust_events(pg_temp.id('omid'), current_date) where loan_id = (select id from l where name = 'overdue')),
  'a repayment waiting for the lender freezes the penalty');
select tests.check(
  exists (select 1 from public.trust_events(pg_temp.id('omid'), current_date + 20) where loan_id = (select id from l where name = 'overdue') and kind = 'overdue'),
  'the freeze ends after 14 days if the lender never answers');

-- 6. Anti-gaming: the same two friends again and again ---------------------------------
create temp table loop_ids (n int, id uuid) on commit drop;
insert into loop_ids select g, pg_temp.loan('eve', 'nima', 10000, current_date, current_date + 30) from generate_series(1, 6) g;
select pg_temp.repay(id, current_date + n, 10 + n) from loop_ids;
select tests.check(
  (select array_agg(e.weight order by e.event_date) = array_agg(e.weight order by e.event_date)
     and (array_agg(e.weight order by e.event_date))[2] < (array_agg(e.weight order by e.event_date))[1] * 0.6
   from public.trust_events(pg_temp.id('nima'), current_date + 20) e
   where e.counterparty = pg_temp.id('eve') and e.role = 'borrower'),
  'each repeat with the same person counts about half of the one before');
select tests.check(
  (select sum(points) <= 30 from public.trust_events(pg_temp.id('nima'), current_date + 20) e where e.counterparty = pg_temp.id('eve') and e.points > 0),
  'positive points from one person are capped');

insert into l values ('fast', pg_temp.loan('sara', 'eve', 10000, current_date, current_date + 30));
select pg_temp.repay((select id from l where name = 'fast'), current_date, 0);
select tests.check(
  (select weight < 0.2 from public.trust_events(pg_temp.id('eve'), current_date + 1) where loan_id = (select id from l where name = 'fast')),
  'a loan settled within 3 days counts very little');

-- Negatives are never reduced for repeats.
insert into l values ('late2', pg_temp.loan('omid', 'sara', 10000, current_date, current_date + 2));
select pg_temp.repay((select id from l where name = 'late2'), current_date + 12, 12);
select tests.check(
  (select count(*) = 2 and min(base_points) = -14 and max(base_points) = -14 and min(weight) = max(weight)
   from public.trust_events(pg_temp.id('sara'), current_date + 13) e
   where e.counterparty = pg_temp.id('omid') and e.kind = 'late'),
  'a second late repayment to the same person is penalised in full');

-- Records with someone who has no account never count.
select set_config('iou.internal_change', 'on', true);
insert into public.loans (creator_id, lender_id, counterparty_name, amount_minor, currency, status)
values (pg_temp.id('sara'), pg_temp.id('sara'), 'Friend without app', 10000, 'USD', 'confirmed');
select set_config('iou.internal_change', '', true);
select tests.check(
  not exists (select 1 from public.trust_events(pg_temp.id('sara'), current_date) e where e.counterparty is null),
  'records with a person who has no account are not scored');

-- 7. Score and card -------------------------------------------------------------------
select tests.check((public.trust_score(pg_temp.id('ali')) ->> 'is_new')::boolean, 'one settled record: still a new user');
select tests.check((public.trust_score(pg_temp.id('sara')) ->> 'is_new')::boolean = false, 'enough history: a score is shown');
select tests.check(
  (public.trust_score(pg_temp.id('sara'), current_date + 20) ->> 'score')::int between 0 and 100
  and (public.trust_score(pg_temp.id('sara'), current_date + 20) ->> 'on_time_pct')::int = 50,
  'score is 0-100; 2 on time and 2 late = 50% on time');

select tests.as_user(pg_temp.id('omid'));
select tests.check_fails(format('select public.trust_score(%L)', pg_temp.id('sara')), 'nobody can call the score function directly');
select tests.check_fails(format('select * from public.trust_events(%L)', pg_temp.id('sara')), 'nobody can read raw events');
select tests.check(
  (public.trust_card_for_loan((select id from l where name = 'late')) ->> 'display_name') is not null
  and not (public.trust_card_for_loan((select id from l where name = 'late')) ? 'raw'),
  'a party sees the other person''s card, without raw numbers');
select tests.check(
  public.trust_card_for_loan((select id from l where name = 'ontime')) ->> 'error' = 'not_found',
  'someone outside the record cannot see the card');
select tests.check_fails('select * from public.score_config', 'the config is not readable by users');

select tests.as_user(pg_temp.id('sara'));
update public.profiles set card_hidden = true where id = pg_temp.id('sara');
select tests.as_user(pg_temp.id('omid'));
select tests.check(
  (public.trust_card_for_loan((select id from l where name = 'late')) ->> 'hidden')::boolean
  and not (public.trust_card_for_loan((select id from l where name = 'late')) ? 'score'),
  'a hidden card shows only the name');
select tests.as_user(pg_temp.id('sara'));
update public.profiles set card_hidden = false where id = pg_temp.id('sara');

-- Card links.
create temp table tok (t text) on commit drop;
grant all on tok to anon, authenticated;
insert into tok select public.create_card_link(7) ->> 'token';
select tests.check((select length(t) = 64 from tok), 'a card link has a long random token');
select tests.check((public.my_trust() -> 'money' -> 0 ->> 'currency') = 'USD', 'my portfolio lists money per currency');
select tests.check(jsonb_array_length(public.my_trust() -> 'trend') = 7, 'my portfolio has a 7-point trend');
select tests.as_anon();
select tests.check(
  (select (public.trust_card_by_token(t) ->> 'is_new') is not null from tok),
  'anyone with the link sees the card without an account');
select tests.check_fails('select public.my_trust()', 'visitors cannot read a portfolio');
select tests.check(public.trust_card_by_token(repeat('a', 64)) ->> 'error' = 'not_found', 'a wrong token finds nothing');
select tests.as_user(pg_temp.id('sara'));
select public.revoke_card_link(t) from tok;
select tests.as_anon();
select tests.check((select public.trust_card_by_token(t) ->> 'error' = 'expired' from tok), 'a revoked link stops working');
select tests.check_fails(format('select public.create_card_link(%s)', 7), 'visitors cannot create links');
select tests.as_admin();
delete from tok;
insert into tok select share_token from public.loans where id = (select id from l where name = 'overdue');
select tests.as_anon();
select tests.check(
  (select public.trust_card_by_loan_token(t) ->> 'display_name' is not null from tok),
  'the record link shows the writer''s card to the visitor');

rollback;
