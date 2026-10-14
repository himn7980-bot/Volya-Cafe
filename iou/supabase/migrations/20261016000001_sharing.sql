-- Phase 3: share links and confirmation without an account.
--
-- The other person opens https://<site>/c/#<share_token>. The public page
-- (web/) calls the two anon functions below. They only work while the record
-- waits for an answer (pending or disputed) and the link is not older than 30
-- days. Once confirmed, the link stops showing the record. Every call is
-- rate-limited per IP address, and failed lookups get a much lower limit, to
-- make guessing tokens pointless (they have ~244 random bits anyway).
--
-- Phone numbers are never returned by the public functions.

-- ---------------------------------------------------------------------------
-- Link expiry
-- ---------------------------------------------------------------------------

alter table public.loans
  add column share_expires_at timestamptz not null default now() + interval '30 days';

-- Whenever a record (again) waits for an answer, the link gets a fresh 30 days.
create or replace function public.loans_refresh_share_expiry()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status <> 'pending' or new.version <> old.version) then
    new.share_expires_at := now() + interval '30 days';
  end if;
  return new;
end;
$$;

-- Runs after the main before-triggers (alphabetical order: "loans_before_*" < "loans_share_*").
create trigger loans_share_expiry
  before insert or update on public.loans
  for each row execute function public.loans_refresh_share_expiry();

-- ---------------------------------------------------------------------------
-- History attribution and comments
-- ---------------------------------------------------------------------------

-- Changes made through the public link have no account: changed_by is null.
-- A dispute comment is stored in that version's snapshot so the history is
-- complete on its own.
create or replace function public.loans_record_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor   text := coalesce(current_setting('iou.actor', true), '');
  comment text := nullif(current_setting('iou.comment', true), '');
  snap    jsonb;
begin
  if tg_op = 'INSERT' or new.version <> old.version then
    snap := to_jsonb(new) - 'share_token' - 'share_expires_at';
    if comment is not null then
      snap := snap || jsonb_build_object('comment', comment);
    end if;
    insert into public.loan_versions (loan_id, version, changed_by, snapshot)
    values (
      new.id,
      new.version,
      case when actor = 'link' then null else coalesce(auth.uid(), new.creator_id) end,
      snap
    );
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Disputes
-- ---------------------------------------------------------------------------

create table public.disputes (
  id           bigint generated always as identity primary key,
  loan_id      uuid references public.loans (id) on delete cascade,
  repayment_id uuid, -- foreign key added with repayments (phase 4)
  raised_by    uuid references public.profiles (id) on delete set null, -- null: via the public link
  comment      text not null check (char_length(btrim(comment)) between 1 and 500),
  created_at   timestamptz not null default now(),
  constraint disputes_one_target check ((loan_id is null) <> (repayment_id is null))
);

create index disputes_loan_idx on public.disputes (loan_id);

alter table public.disputes enable row level security;

create policy "disputes: parties can read"
  on public.disputes for select
  to authenticated
  using (loan_id is not null and public.is_loan_party(loan_id));

revoke all on public.disputes from anon, authenticated;
grant select on public.disputes to authenticated;

-- ---------------------------------------------------------------------------
-- Rate limiting
-- ---------------------------------------------------------------------------

create table public.rate_limits (
  key          text primary key,
  window_start timestamptz not null,
  hits         integer not null
);
alter table public.rate_limits enable row level security; -- no policies: only definer functions touch it
revoke all on public.rate_limits from anon, authenticated;

-- The caller's IP as seen by the API gateway, or 'unknown'.
create or replace function public.request_ip()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.headers', true), '')::json ->> 'cf-connecting-ip',
    split_part(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1),
    'unknown'
  )
$$;

-- Count one hit for `bucket` and return false when it is over `max_hits`
-- within `window_seconds`. Keys are hashed so no raw IPs are stored.
create or replace function public.rate_limit_hit(bucket text, max_hits integer, window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  k     text := md5(bucket);
  now_  timestamptz := now();
  count integer;
begin
  insert into public.rate_limits as r (key, window_start, hits)
  values (k, now_, 1)
  on conflict (key) do update
    set hits = case when r.window_start < now_ - make_interval(secs => window_seconds) then 1 else r.hits + 1 end,
        window_start = case when r.window_start < now_ - make_interval(secs => window_seconds) then now_ else r.window_start end
  returning hits into count;

  -- Opportunistic cleanup of old windows.
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now_ - interval '1 day';
  end if;

  return count <= max_hits;
end;
$$;

revoke execute on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Public functions (no account)
-- ---------------------------------------------------------------------------

create or replace function public.share_link_open(l public.loans)
returns boolean
language sql
stable
as $$
  select l.status in ('pending', 'disputed') and l.share_expires_at > now()
$$;

-- What the public page shows. Never includes phone numbers.
create or replace function public.get_shared_loan(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ip text := public.request_ip();
  l  public.loans;
  creator public.profiles;
  last_comment text;
begin
  if not public.rate_limit_hit('view:' || ip, 120, 600) then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  select * into l from public.loans where share_token = p_token;
  if not found or p_token is null or length(p_token) <> 64 then
    -- Misses are limited much harder than hits: no point guessing tokens.
    if not public.rate_limit_hit('miss:' || ip, 20, 3600) then
      return jsonb_build_object('error', 'rate_limited');
    end if;
    return jsonb_build_object('error', 'not_found');
  end if;

  select * into creator from public.profiles where id = l.creator_id;

  if not public.share_link_open(l) then
    -- Confirmed, settled, cancelled or too old: say so, show nothing else.
    return jsonb_build_object(
      'status', l.status,
      'open', false,
      'creator_name', creator.display_name,
      'language', creator.language
    );
  end if;

  select d.comment into last_comment
  from public.disputes d where d.loan_id = l.id order by d.created_at desc limit 1;

  return jsonb_build_object(
    'status', l.status,
    'open', true,
    'creator_name', creator.display_name,
    'language', creator.language,
    'creator_role', case when l.creator_id = l.lender_id then 'lender' else 'borrower' end,
    'counterparty_name', l.counterparty_name,
    'amount_minor', l.amount_minor,
    'currency', l.currency,
    'note', l.note,
    'loan_date', l.loan_date,
    'due_date', l.due_date,
    'has_photo', l.photo_path is not null,
    'dispute_comment', case when l.status = 'disputed' then last_comment end,
    'version', l.version
  );
end;
$$;

-- Shared by the public link and the in-app answer.
create or replace function public.apply_loan_answer(
  p_loan public.loans,
  p_action text,
  p_comment text,
  p_actor text,          -- 'link' or 'app'
  p_raised_by uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if p_action not in ('confirm', 'dispute') then
    raise exception 'unknown action' using errcode = 'invalid_parameter_value';
  end if;
  if p_loan.status not in ('pending', 'disputed') then
    raise exception 'this record is not waiting for an answer' using errcode = 'check_violation';
  end if;
  if p_action = 'dispute' then
    if p_loan.status = 'disputed' then
      raise exception 'already disputed' using errcode = 'check_violation';
    end if;
    if clean is null or char_length(clean) > 500 then
      raise exception 'a comment of 1-500 characters is required' using errcode = 'check_violation';
    end if;
    insert into public.disputes (loan_id, raised_by, comment) values (p_loan.id, p_raised_by, clean);
  end if;

  perform set_config('iou.internal_change', 'on', true);
  perform set_config('iou.actor', p_actor, true);
  perform set_config('iou.comment', case when p_action = 'dispute' then clean else '' end, true);
  update public.loans
     set status = case when p_action = 'confirm' then 'confirmed' else 'disputed' end
   where id = p_loan.id;
  perform set_config('iou.internal_change', '', true);
  perform set_config('iou.actor', '', true);
  perform set_config('iou.comment', '', true);

  return case when p_action = 'confirm' then 'confirmed' else 'disputed' end;
end;
$$;

revoke execute on function public.apply_loan_answer(public.loans, text, text, text, uuid) from public, anon, authenticated;

-- Confirm or dispute through the public link.
-- p_version must match what the page showed, so nobody confirms an amount
-- they never saw (the creator may have edited it meanwhile).
create or replace function public.respond_shared_loan(p_token text, p_action text, p_comment text, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ip text := public.request_ip();
  l  public.loans;
  status text;
begin
  if not public.rate_limit_hit('answer:' || ip, 20, 3600) then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  select * into l from public.loans where share_token = p_token for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if not public.rate_limit_hit('answer-token:' || p_token, 5, 3600) then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  if not public.share_link_open(l) then
    return jsonb_build_object('error', 'closed', 'status', l.status);
  end if;
  if l.version <> p_version then
    return jsonb_build_object('error', 'changed');
  end if;
  status := public.apply_loan_answer(l, p_action, p_comment, 'link', null);
  return jsonb_build_object('status', status);
exception
  when check_violation or invalid_parameter_value then
    return jsonb_build_object('error', 'invalid');
end;
$$;

grant execute on function public.get_shared_loan(text) to anon, authenticated;
grant execute on function public.respond_shared_loan(text, text, text, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- In the app: the other party answers, and links records to their account
-- ---------------------------------------------------------------------------

-- The other party (not the creator) confirms or disputes in the app.
create or replace function public.respond_to_loan(p_loan_id uuid, p_action text, p_comment text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  l  public.loans;
begin
  select * into l from public.loans where id = p_loan_id for update;
  -- coalesce: a comparison with an empty (null) party slot must count as "no".
  if not found or me is null or me = l.creator_id
     or not coalesce(me = l.lender_id or me = l.borrower_id, false) then
    raise exception 'only the other party can answer' using errcode = 'insufficient_privilege';
  end if;
  return public.apply_loan_answer(l, p_action, p_comment, 'app', me);
end;
$$;

-- Put the signed-in person into the empty party slot of a shared record
-- (they opened the link with the app installed).
create or replace function public.claim_shared_loan(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  l  public.loans;
begin
  if me is null then
    raise exception 'sign in first' using errcode = 'insufficient_privilege';
  end if;
  if not public.rate_limit_hit('claim:' || me::text, 30, 3600) then
    raise exception 'too many attempts' using errcode = 'insufficient_privilege';
  end if;
  select * into l from public.loans where share_token = p_token for update;
  if not found then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
  if me in (l.creator_id, l.lender_id, l.borrower_id) then
    return l.id; -- already mine
  end if;
  if l.status in ('cancelled') or (l.lender_id is not null and l.borrower_id is not null) then
    raise exception 'this record already belongs to someone else' using errcode = 'insufficient_privilege';
  end if;
  perform set_config('iou.internal_change', 'on', true);
  update public.loans
     set lender_id = coalesce(lender_id, case when borrower_id is not null then me end),
         borrower_id = coalesce(borrower_id, case when lender_id is not null then me end)
   where id = l.id;
  perform set_config('iou.internal_change', '', true);
  return l.id;
end;
$$;

-- Link every record whose creator entered the signed-in person's verified
-- phone number. Returns how many were linked.
create or replace function public.claim_loans_by_phone()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  my_phone text;
  n integer;
begin
  select phone into my_phone from public.profiles where id = me;
  if my_phone is null then
    return 0;
  end if;
  perform set_config('iou.internal_change', 'on', true);
  update public.loans
     set lender_id = coalesce(lender_id, case when borrower_id is not null then me end),
         borrower_id = coalesce(borrower_id, case when lender_id is not null then me end)
   where counterparty_phone = my_phone
     and creator_id <> me
     and status <> 'cancelled'
     and (lender_id is null or borrower_id is null);
  get diagnostics n = row_count;
  perform set_config('iou.internal_change', '', true);
  return n;
end;
$$;

-- Names (and languages, for writing to them) of people who share a record
-- with me. Nothing else about them: no phone, no email.
create or replace function public.my_counterparts()
returns table (id uuid, display_name text, language text, avatar_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct p.id, p.display_name, p.language, p.avatar_path
  from public.loans l
  join public.profiles p
    on p.id in (l.creator_id, l.lender_id, l.borrower_id)
  where (select auth.uid()) in (l.creator_id, l.lender_id, l.borrower_id)
    and p.id <> (select auth.uid())
$$;

revoke execute on function public.respond_to_loan(uuid, text, text) from public, anon;
revoke execute on function public.claim_shared_loan(text) from public, anon;
revoke execute on function public.claim_loans_by_phone() from public, anon;
revoke execute on function public.my_counterparts() from public, anon;
grant execute on function public.respond_to_loan(uuid, text, text) to authenticated;
grant execute on function public.claim_shared_loan(text) to authenticated;
grant execute on function public.claim_loans_by_phone() to authenticated;
grant execute on function public.my_counterparts() to authenticated;

-- Avatars of counterparts become visible to the people who share a record.
create policy "avatars: counterparts can read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'avatars'
    and exists (select 1 from public.my_counterparts() c where c.id::text = (storage.foldername(name))[1])
  );
