-- Trust score ("اعتبار دوستانه"), due-date extensions and trust cards.
--
-- Rules enforced here (not in the app):
--  * Only loans between two accounts, confirmed by both (status confirmed or
--    settled), ever count. Repayments count only once the lender confirmed them.
--  * An extension accepted by both parties replaces the due date. If it was
--    agreed after the old due date, the days late until the agreement still count.
--  * A record with a recent disputed or pending repayment is frozen (no
--    penalty) for `freeze_days`, so neither side can hold the other hostage
--    forever, and neither can freeze a debt by raising disputes.
--  * Positive points are reduced for repeated loans with the same person, tiny
--    or very fast loops and brand-new accounts. Negative points are never reduced
--    (only faded by age, like everything else).
--  * Everything is computed here, on demand. The app never computes or writes scores.
--  * Cards are only reachable through a loan both people are part of, or a
--    card link the owner created. There is no search.

-- ---------------------------------------------------------------------------
-- Tunable constants
-- ---------------------------------------------------------------------------

create table public.score_config (
  key   text primary key,
  value numeric not null,
  note  text not null default ''
);

insert into public.score_config (key, value, note) values
  ('base_on_time',            10,   'repaid on time (borrower)'),
  ('base_no_due',              5,   'repaid, no due date (borrower)'),
  ('base_lender',              3,   'lent and got it back (lender)'),
  ('late_base',                5,   'penalty for any lateness'),
  ('late_per_day',             1,   'extra penalty per day late'),
  ('late_cap',                40,   'max penalty for one record'),
  ('grace_days',               1,   'days after the due date that are not late'),
  ('pair_decay',             0.5,   'n-th positive with the same person counts decay^(n-1)'),
  ('pair_window_days',       365,   'window for counting repeats with the same person'),
  ('pair_cap',                30,   'max positive points from one person'),
  ('fast_days',                3,   'settled within this many days of creation = fast'),
  ('fast_weight',            0.3,   'weight for fast loops'),
  ('new_account_days',        30,   'counterparty younger than this at loan time'),
  ('new_counterparty_weight', 0.5,  'weight for new / single-contact counterparties'),
  ('amount_min',             0.5,   'min amount weight'),
  ('amount_max',               2,   'max amount weight'),
  ('amount_slope',           0.5,   'amount weight = 1 + slope*log10(amount/reference)'),
  ('half_life_days',         365,   'events fade by half every this many days'),
  ('freeze_days',             14,   'freeze after a disputed / pending repayment'),
  ('min_settled',              3,   'settled records needed before a score is shown'),
  ('min_counterparties',       2,   'distinct people needed before a score is shown'),
  ('display_scale',           40,   'display = 50 + 50*tanh(raw/scale)'),
  ('level_excellent',         85,   ''),
  ('level_good',              70,   ''),
  ('level_fair',              50,   ''),
  ('level_weak',              30,   ''),
  ('band_medium',              5,   'counted records for the Medium band'),
  ('band_high',               20,   'counted records for the High band');

-- A "normal" loan size per currency, in minor units. Missing currency: weight 1.
create table public.score_currency_ref (
  currency  text primary key check (currency ~ '^[A-Z]{3}$'),
  ref_minor bigint not null check (ref_minor > 0)
);

insert into public.score_currency_ref (currency, ref_minor) values
  ('USD', 10000), ('EUR', 10000), ('GBP', 10000), ('AED', 40000), ('SAR', 40000),
  ('TRY', 400000), ('IQD', 150000000), ('IRR', 100000000);

alter table public.score_config enable row level security;
alter table public.score_currency_ref enable row level security;
revoke all on public.score_config, public.score_currency_ref from anon, authenticated;

create or replace function public.score_cfg(p_key text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select value from public.score_config where key = p_key
$$;

-- ---------------------------------------------------------------------------
-- Due-date extensions
-- ---------------------------------------------------------------------------

create table public.loan_extensions (
  id            uuid primary key default gen_random_uuid(),
  loan_id       uuid not null references public.loans (id) on delete cascade,
  proposed_by   uuid references public.profiles (id) on delete set null,
  old_due_date  date not null,
  new_due_date  date not null,
  reason        text not null default '' check (char_length(reason) <= 300),
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,
  constraint loan_extensions_later check (new_due_date > old_due_date)
);

create index loan_extensions_loan_idx on public.loan_extensions (loan_id);
create unique index loan_extensions_one_pending on public.loan_extensions (loan_id) where status = 'pending';

alter table public.loan_extensions enable row level security;
create policy "loan_extensions: parties can read"
  on public.loan_extensions for select to authenticated
  using (public.is_loan_party(loan_id));
revoke all on public.loan_extensions from anon, authenticated;
grant select on public.loan_extensions to authenticated;

-- Ask the other person to move the due date.
create or replace function public.propose_extension(p_loan_id uuid, p_new_due date, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me  uuid := auth.uid();
  l   public.loans;
  eid uuid;
  other uuid;
begin
  select * into l from public.loans where id = p_loan_id for update;
  if not found or me is null or me not in (l.lender_id, l.borrower_id) then
    raise exception 'record not found' using errcode = 'no_data_found';
  end if;
  if l.status <> 'confirmed' or l.lender_id is null or l.borrower_id is null then
    raise exception 'only confirmed records between two accounts can be extended' using errcode = 'check_violation';
  end if;
  if l.due_date is null then
    raise exception 'this record has no due date' using errcode = 'check_violation';
  end if;
  if p_new_due is null or p_new_due <= l.due_date or p_new_due < current_date then
    raise exception 'the new date must be later than the current due date and not in the past' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.loan_extensions where loan_id = l.id and status = 'pending') then
    raise exception 'there is already a request waiting for an answer' using errcode = 'unique_violation';
  end if;

  insert into public.loan_extensions (loan_id, proposed_by, old_due_date, new_due_date, reason)
  values (l.id, me, l.due_date, p_new_due, btrim(coalesce(p_reason, '')))
  returning id into eid;

  other := case when me = l.lender_id then l.borrower_id else l.lender_id end;
  perform public.notify(other, 'extension_new', public.loan_payload(l, other,
    jsonb_build_object('extension_id', eid, 'new_due_date', p_new_due)));
  return eid;
end;
$$;

-- Accept, reject (other party) or cancel (proposer) a pending extension.
create or replace function public.respond_to_extension(p_extension_id uuid, p_action text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  e  public.loan_extensions;
  l  public.loans;
  new_status text;
begin
  select * into e from public.loan_extensions where id = p_extension_id for update;
  if not found then
    raise exception 'request not found' using errcode = 'no_data_found';
  end if;
  select * into l from public.loans where id = e.loan_id for update;
  if me is null or me not in (l.lender_id, l.borrower_id) then
    raise exception 'request not found' using errcode = 'no_data_found';
  end if;
  if e.status <> 'pending' then
    raise exception 'this request is not waiting for an answer' using errcode = 'check_violation';
  end if;
  if p_action = 'cancel' then
    if e.proposed_by is distinct from me then
      raise exception 'only the person who asked can cancel' using errcode = 'insufficient_privilege';
    end if;
    new_status := 'cancelled';
  elsif p_action in ('accept', 'reject') then
    if e.proposed_by = me then
      raise exception 'the other person has to answer' using errcode = 'insufficient_privilege';
    end if;
    new_status := case when p_action = 'accept' then 'accepted' else 'rejected' end;
  else
    raise exception 'unknown action' using errcode = 'invalid_parameter_value';
  end if;

  if new_status = 'accepted' and (l.status <> 'confirmed' or l.due_date is distinct from e.old_due_date) then
    -- The record changed since the request: it no longer applies.
    update public.loan_extensions set status = 'cancelled', responded_at = now() where id = e.id;
    raise exception 'the record changed since this request' using errcode = 'check_violation';
  end if;

  update public.loan_extensions set status = new_status, responded_at = now() where id = e.id;

  if new_status = 'accepted' then
    -- Agreed by both: move the due date without asking for re-confirmation.
    perform set_config('iou.internal_change', 'on', true);
    update public.loans set due_date = e.new_due_date where id = l.id;
    perform set_config('iou.internal_change', '', true);
  end if;

  if new_status in ('accepted', 'rejected') then
    perform public.notify(e.proposed_by, 'extension_' || new_status, public.loan_payload(l, e.proposed_by,
      jsonb_build_object('extension_id', e.id, 'new_due_date', e.new_due_date)));
  end if;
  return new_status;
end;
$$;

revoke execute on function public.propose_extension(uuid, date, text) from public, anon;
revoke execute on function public.respond_to_extension(uuid, text) from public, anon;
grant execute on function public.propose_extension(uuid, date, text) to authenticated;
grant execute on function public.respond_to_extension(uuid, text) to authenticated;

-- A record changed by its creator (new terms) drops any waiting extension request.
create or replace function public.loans_drop_extensions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (not public.loans_internal_change() and new.due_date is distinct from old.due_date)
     or new.status <> 'confirmed' then
    update public.loan_extensions set status = 'cancelled', responded_at = now()
    where loan_id = new.id and status = 'pending';
  end if;
  return null;
end;
$$;

create trigger loans_drop_extensions
  after update on public.loans
  for each row execute function public.loans_drop_extensions();

-- ---------------------------------------------------------------------------
-- Score events
-- ---------------------------------------------------------------------------

-- Records that may count: two accounts, agreed by both.
create or replace function public.scored_loans()
returns setof public.loans
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.loans
  where status in ('confirmed', 'settled') and lender_id is not null and borrower_id is not null
$$;

-- Every scoring event for one person, as things stood on p_as_of.
create or replace function public.trust_events(p_user uuid, p_as_of date default current_date)
returns table (
  loan_id        uuid,
  role           text,      -- borrower | lender
  counterparty   uuid,
  currency       text,
  amount_minor   bigint,
  event_date     date,
  kind           text,      -- on_time | no_due | late | overdue | lent
  late_days      integer,
  base_points    numeric,
  weight         numeric,
  points         numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  c_grace       numeric := public.score_cfg('grace_days');
  c_freeze      numeric := public.score_cfg('freeze_days');
  c_fast_days   numeric := public.score_cfg('fast_days');
  c_fast_w      numeric := public.score_cfg('fast_weight');
  c_new_days    numeric := public.score_cfg('new_account_days');
  c_new_w       numeric := public.score_cfg('new_counterparty_weight');
  c_amin        numeric := public.score_cfg('amount_min');
  c_amax        numeric := public.score_cfg('amount_max');
  c_aslope      numeric := public.score_cfg('amount_slope');
  c_decay       numeric := public.score_cfg('pair_decay');
  c_window      numeric := public.score_cfg('pair_window_days');
  c_pair_cap    numeric := public.score_cfg('pair_cap');
  c_half        numeric := public.score_cfg('half_life_days');
  c_late_base   numeric := public.score_cfg('late_base');
  c_late_day    numeric := public.score_cfg('late_per_day');
  c_late_cap    numeric := public.score_cfg('late_cap');
  c_on_time     numeric := public.score_cfg('base_on_time');
  c_no_due      numeric := public.score_cfg('base_no_due');
  c_lender      numeric := public.score_cfg('base_lender');
  as_of_ts      timestamptz := (p_as_of + 1)::timestamptz; -- end of that day
begin
  return query
  with base as (
    select l.*,
           case when l.lender_id = p_user then 'lender' else 'borrower' end as my_role,
           case when l.lender_id = p_user then l.borrower_id else l.lender_id end as cp
    from public.scored_loans() l
    where p_user in (l.lender_id, l.borrower_id)
      and l.created_at < as_of_ts
  ),
  paid as (
    -- Fully repaid by p_as_of? Then when (the later of: day paid, day confirmed).
    select b.id,
           case when coalesce(sum(r.amount_minor), 0) >= b.amount_minor
                then greatest(max(r.paid_on), max(r.responded_at)::date)
           end as finish_date,
           max(r.responded_at) as finish_ts
    from base b
    left join public.repayments r
      on r.loan_id = b.id and r.status = 'confirmed' and r.responded_at < as_of_ts
    group by b.id, b.amount_minor
  ),
  due as (
    -- Original due date and lateness accrued before each agreed extension.
    select b.id,
           coalesce((select e.old_due_date from public.loan_extensions e
                     where e.loan_id = b.id and e.status = 'accepted' and e.responded_at < as_of_ts
                     order by e.responded_at limit 1), b.due_date) as first_due
    from base b
  ),
  late as (
    select b.id,
           p.finish_date,
           p.finish_ts,
           d.first_due,
           -- Walk the accepted extensions in order.
           (with recursive ext as (
              select row_number() over (order by e.responded_at) as n, e.responded_at::date as agreed_on, e.new_due_date
              from public.loan_extensions e
              where e.loan_id = b.id and e.status = 'accepted' and e.responded_at < as_of_ts
            ),
            walk(n, cur_due, late_days) as (
              select 0::bigint, d.first_due, 0
              union all
              select x.n, x.new_due_date,
                     w.late_days + greatest(0, least(x.agreed_on, coalesce(p.finish_date, x.agreed_on)) - w.cur_due)
              from walk w join ext x on x.n = w.n + 1
            )
            select jsonb_build_object('due', walk.cur_due, 'late', walk.late_days) from walk order by walk.n desc limit 1) as w
    from base b join paid p on p.id = b.id join due d on d.id = b.id
  ),
  frozen as (
    select b.id,
           exists (select 1 from public.repayments r
                   where r.loan_id = b.id
                     and ((r.status = 'disputed' and r.responded_at >= as_of_ts - make_interval(days => c_freeze::int)
                           and r.responded_at < as_of_ts)
                       or (r.status = 'pending' and r.created_at >= as_of_ts - make_interval(days => c_freeze::int)
                           and r.created_at < as_of_ts))) as is_frozen
    from base b
  ),
  ev as (
    select b.id, b.my_role, b.cp, b.currency, b.amount_minor, b.created_at, b.due_date,
           lt.finish_date, lt.finish_ts, lt.first_due,
           (lt.w ->> 'due')::date as cur_due,
           (lt.w ->> 'late')::int as late_before,
           f.is_frozen
    from base b join late lt on lt.id = b.id join frozen f on f.id = b.id
  ),
  classified as (
    select ev.*,
           case
             when ev.my_role = 'lender' then
               case when ev.finish_date is not null then 'lent' end
             when ev.finish_date is not null then
               case when ev.first_due is null then 'no_due'
                    when ev.late_before + greatest(0, ev.finish_date - ev.cur_due) <= c_grace then 'on_time'
                    else 'late' end
             when ev.cur_due is not null and not ev.is_frozen
                  and ev.late_before + greatest(0, p_as_of - ev.cur_due) > c_grace then 'overdue'
           end as k,
           case
             when ev.my_role = 'borrower' and ev.cur_due is not null then
               ev.late_before + greatest(0, coalesce(ev.finish_date, p_as_of) - ev.cur_due)
             else 0
           end as days_late,
           coalesce(ev.finish_date, p_as_of) as edate
    from ev
  ),
  scored as (
    select c.*,
           case c.k
             when 'on_time' then c_on_time
             when 'no_due'  then c_no_due
             when 'lent'    then c_lender
             else -least(c_late_cap, c_late_base + c_late_day * greatest(0, c.days_late - c_grace))
           end as bp,
           -- Positive-only weights.
           greatest(c_amin, least(c_amax, 1 + c_aslope * log(10::numeric,
             greatest(c.amount_minor::numeric, 1) / coalesce((select r.ref_minor from public.score_currency_ref r where r.currency = c.currency), c.amount_minor)::numeric)))
             as w_amount,
           case when c.finish_ts is not null and c.finish_ts - c.created_at < make_interval(days => c_fast_days::int)
                then c_fast_w else 1 end as w_fast,
           case when (select c.created_at - p.created_at < make_interval(days => c_new_days::int) from public.profiles p where p.id = c.cp)
                  or (select count(distinct case when s.lender_id = c.cp then s.borrower_id else s.lender_id end)
                      from public.scored_loans() s where c.cp in (s.lender_id, s.borrower_id)) <= 1
                then c_new_w else 1 end as w_new,
           power(0.5::numeric, greatest(0, p_as_of - c.edate)::numeric / c_half) as w_age
    from classified c
    where c.k is not null
  ),
  ranked as (
    select s.*,
           case when s.bp > 0 then
             (select count(*) from scored s2
              where s2.bp > 0 and s2.cp = s.cp
                and (s2.edate, s2.id) <= (s.edate, s.id)
                and s2.edate > s.edate - c_window::int)
           end as pair_n
    from scored s
  ),
  weighted as (
    select r.*,
           case when r.bp > 0
                then r.w_amount * r.w_fast * r.w_new * power(c_decay, r.pair_n - 1) * r.w_age
                else r.w_age end as w
    from ranked r
  ),
  capped as (
    -- Cap the running total of positive points from one person.
    select wt.*,
           sum(case when wt.bp > 0 then wt.bp * wt.w else 0 end)
             over (partition by wt.cp order by wt.edate, wt.id rows unbounded preceding) as pos_running
    from weighted wt
  )
  select cp.id, cp.my_role, cp.cp, cp.currency, cp.amount_minor, cp.edate, cp.k, cp.days_late::int,
         cp.bp, round(cp.w, 4),
         round(case when cp.bp > 0
                    then greatest(0, least(cp.bp * cp.w, c_pair_cap - (cp.pos_running - cp.bp * cp.w)))
                    else cp.bp * cp.w end, 2)
  from capped cp
  order by cp.edate, cp.id;
end;
$$;

revoke execute on function public.score_cfg(text) from public, anon, authenticated;
revoke execute on function public.scored_loans() from public, anon, authenticated;
revoke execute on function public.trust_events(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Score + public card
-- ---------------------------------------------------------------------------

alter table public.profiles add column card_hidden boolean not null default false;
grant update (card_hidden) on public.profiles to authenticated;

create or replace function public.trust_score(p_user uuid, p_as_of date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  raw numeric;
  shown integer;
  settled_n integer;
  counterparties_n integer;
  counted_n integer;
  borrower_good integer;
  borrower_bad integer;
  is_new boolean;
  lvl text;
  band text;
begin
  select coalesce(sum(points), 0),
         count(*) filter (where kind in ('on_time', 'no_due')),
         count(*) filter (where kind in ('late', 'overdue'))
  into raw, borrower_good, borrower_bad
  from public.trust_events(p_user, p_as_of);

  select count(*) filter (where l.status = 'settled'),
         count(distinct case when l.lender_id = p_user then l.borrower_id else l.lender_id end),
         count(*)
  into settled_n, counterparties_n, counted_n
  from public.scored_loans() l
  where p_user in (l.lender_id, l.borrower_id) and l.created_at < (p_as_of + 1)::timestamptz;

  is_new := settled_n < public.score_cfg('min_settled') or counterparties_n < public.score_cfg('min_counterparties');
  shown := round(50 + 50 * tanh(raw / public.score_cfg('display_scale')));
  lvl := case
    when shown >= public.score_cfg('level_excellent') then 'excellent'
    when shown >= public.score_cfg('level_good') then 'good'
    when shown >= public.score_cfg('level_fair') then 'fair'
    when shown >= public.score_cfg('level_weak') then 'weak'
    else 'poor' end;
  band := case
    when counted_n >= public.score_cfg('band_high') then 'high'
    when counted_n >= public.score_cfg('band_medium') then 'medium'
    else 'low' end;

  return jsonb_build_object(
    'is_new', is_new,
    'score', case when is_new then null else shown end,
    'level', case when is_new then null else lvl end,
    'raw', round(raw, 2),
    'on_time_pct', case when borrower_good + borrower_bad = 0 then null
                        else round(100.0 * borrower_good / (borrower_good + borrower_bad)) end,
    'settled_count', settled_n,
    'counterparties', counterparties_n,
    'volume_band', band
  );
end;
$$;

revoke execute on function public.trust_score(uuid, date) from public, anon, authenticated;

-- What other people may see: coarse numbers only, never amounts or names of others.
create or replace function public.public_card(p_user uuid, p_owner_view boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.profiles;
  s jsonb;
begin
  select * into p from public.profiles where id = p_user;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if p.card_hidden and not p_owner_view then
    return jsonb_build_object('hidden', true, 'display_name', p.display_name);
  end if;
  s := public.trust_score(p_user);
  return jsonb_build_object(
    'hidden', false,
    'display_name', p.display_name,
    'member_since', p.created_at::date,
    'is_new', s -> 'is_new',
    'score', s -> 'score',
    'level', s -> 'level',
    'on_time_pct', s -> 'on_time_pct',
    'settled_count', s -> 'settled_count',
    'counterparties', s -> 'counterparties',
    'volume_band', s -> 'volume_band'
  );
end;
$$;

revoke execute on function public.public_card(uuid, boolean) from public, anon, authenticated;

-- The other person's card, for someone who shares a record with them (mutual by design).
create or replace function public.trust_card_for_loan(p_loan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  l  public.loans;
  other uuid;
begin
  select * into l from public.loans where id = p_loan_id;
  if not found or me is null or me not in (l.creator_id, l.lender_id, l.borrower_id) then
    return jsonb_build_object('error', 'not_found');
  end if;
  other := case when me = l.lender_id then l.borrower_id
                when me = l.borrower_id then l.lender_id end;
  if other is null then
    return jsonb_build_object('error', 'no_account');
  end if;
  return public.public_card(other);
end;
$$;

revoke execute on function public.trust_card_for_loan(uuid) from public, anon;
grant execute on function public.trust_card_for_loan(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Card links (the owner shares their own card)
-- ---------------------------------------------------------------------------

create table public.card_links (
  token       text primary key default public.new_share_token(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz
);
create index card_links_user_idx on public.card_links (user_id);

alter table public.card_links enable row level security;
create policy "card_links: read own" on public.card_links for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.card_links from anon, authenticated;
grant select on public.card_links to authenticated;

create or replace function public.create_card_link(p_days integer default 7)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  row_ public.card_links;
begin
  if me is null then
    raise exception 'sign in first' using errcode = 'insufficient_privilege';
  end if;
  if p_days is null or p_days < 1 or p_days > 30 then
    raise exception 'a link lasts 1-30 days' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.card_links where user_id = me and created_at > now() - interval '1 day') >= 20 then
    raise exception 'too many links today' using errcode = 'check_violation';
  end if;
  insert into public.card_links (user_id, expires_at) values (me, now() + make_interval(days => p_days))
  returning * into row_;
  return jsonb_build_object('token', row_.token, 'expires_at', row_.expires_at);
end;
$$;

create or replace function public.revoke_card_link(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.card_links set revoked_at = now()
  where token = p_token and user_id = (select auth.uid()) and revoked_at is null
$$;

-- Opened by whoever got the link (no account needed).
create or replace function public.trust_card_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ip text := public.request_ip();
  k  public.card_links;
begin
  if not public.rate_limit_hit('card:' || ip, 120, 600) then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  select * into k from public.card_links where token = p_token;
  if not found or p_token is null or length(p_token) <> 64 then
    if not public.rate_limit_hit('miss:' || ip, 20, 3600) then
      return jsonb_build_object('error', 'rate_limited');
    end if;
    return jsonb_build_object('error', 'not_found');
  end if;
  if k.revoked_at is not null or k.expires_at < now() then
    return jsonb_build_object('error', 'expired');
  end if;
  return public.public_card(k.user_id);
end;
$$;

revoke execute on function public.create_card_link(integer) from public, anon;
revoke execute on function public.revoke_card_link(text) from public, anon;
revoke execute on function public.trust_card_by_token(text) from public;
grant execute on function public.create_card_link(integer) to authenticated;
grant execute on function public.revoke_card_link(text) to authenticated;
grant execute on function public.trust_card_by_token(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- My portfolio (private: only the person themselves)
-- ---------------------------------------------------------------------------

create or replace function public.my_trust()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  v_money jsonb;
  counts jsonb;
  trend jsonb;
  events jsonb;
begin
  if me is null then
    raise exception 'sign in first' using errcode = 'insufficient_privilege';
  end if;

  -- Per currency, never summed across currencies. Agreed records only.
  select coalesce(jsonb_agg(m order by m ->> 'currency'), '[]') into v_money
  from (
    select jsonb_build_object(
      'currency', l.currency,
      'borrowed', coalesce(sum(l.amount_minor) filter (where l.borrower_id = me), 0),
      'repaid', coalesce(sum(public.loan_repaid(l.id, false)) filter (where l.borrower_id = me), 0),
      'lent', coalesce(sum(l.amount_minor) filter (where l.lender_id = me), 0),
      'received', coalesce(sum(public.loan_repaid(l.id, false)) filter (where l.lender_id = me), 0)
    ) as m
    from public.loans l
    where me in (l.lender_id, l.borrower_id) and l.status in ('confirmed', 'settled')
    group by l.currency
  ) x;

  select jsonb_build_object(
    'taken', count(*) filter (where l.borrower_id = me),
    'given', count(*) filter (where l.lender_id = me),
    'settled', count(*) filter (where l.status = 'settled'),
    'open', count(*) filter (where l.status = 'confirmed'),
    'overdue', count(*) filter (where l.status = 'confirmed' and l.due_date < current_date),
    'counterparties', count(distinct case when l.lender_id = me then l.borrower_id else l.lender_id end),
    'extensions', (select count(*) from public.loan_extensions e join public.loans l2 on l2.id = e.loan_id
                   where me in (l2.lender_id, l2.borrower_id) and e.status = 'accepted'),
    'disputes', (select count(*) from public.disputes d
                 left join public.repayments r on r.id = d.repayment_id
                 join public.loans l3 on l3.id = coalesce(d.loan_id, r.loan_id)
                 where me in (l3.creator_id, l3.lender_id, l3.borrower_id))
  ) into counts
  from public.loans l
  where me in (l.lender_id, l.borrower_id) and l.status in ('confirmed', 'settled');

  -- Score at the end of each of the last 6 months, then today.
  select jsonb_agg(jsonb_build_object('date', d, 'score', public.trust_score(me, d) -> 'score',
                                      'raw', public.trust_score(me, d) -> 'raw') order by d)
  into trend
  from (
    select (date_trunc('month', current_date) - make_interval(months => g) - interval '1 day')::date as d
    from generate_series(0, 5) g
    union all select current_date
  ) months;

  -- The 20 latest things that moved the score, with the other person's name.
  select coalesce(jsonb_agg(jsonb_build_object(
           'loan_id', e.loan_id, 'role', e.role, 'kind', e.kind, 'date', e.event_date,
           'late_days', e.late_days, 'points', e.points, 'base_points', e.base_points,
           'name', p.display_name) order by e.event_date desc), '[]')
  into events
  from (select * from public.trust_events(me) order by event_date desc limit 20) e
  left join public.profiles p on p.id = e.counterparty;

  return jsonb_build_object(
    'score', public.trust_score(me),
    'card', public.public_card(me, true), -- what others see (unless hidden)
    'money', v_money,
    'counts', counts,
    'trend', trend,
    'events', events
  );
end;
$$;

revoke execute on function public.my_trust() from public, anon;
grant execute on function public.my_trust() to authenticated;

-- The public confirmation page: before answering, the visitor sees the card of
-- the person who wrote the record (they will see the visitor's once they join).
create or replace function public.trust_card_by_loan_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ip text := public.request_ip();
  l  public.loans;
begin
  if not public.rate_limit_hit('view:' || ip, 120, 600) then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  select * into l from public.loans where share_token = p_token;
  if not found or p_token is null or length(p_token) <> 64 then
    if not public.rate_limit_hit('miss:' || ip, 20, 3600) then
      return jsonb_build_object('error', 'rate_limited');
    end if;
    return jsonb_build_object('error', 'not_found');
  end if;
  if not public.share_link_open(l) and l.status <> 'confirmed' then
    return jsonb_build_object('error', 'expired');
  end if;
  return public.public_card(l.creator_id);
end;
$$;

revoke execute on function public.trust_card_by_loan_token(text) from public;
grant execute on function public.trust_card_by_loan_token(text) to anon, authenticated;
