-- Phase 4: repayments, reminders and notifications.
--
-- Repayments
--  * Either party can record one, only on a confirmed record, and never more
--    than what is still open.
--  * Recorded by the lender (the one receiving the money): confirmed at once,
--    because it only lowers what they are owed. Recorded by the borrower: the
--    lender confirms or disputes it, in the app or (no account) via the link.
--  * When confirmed repayments cover the amount, the record becomes "settled".
--
-- Reminders
--  * Only the lender sends them, at most one manual reminder per 48 hours per
--    record. Optional automatic reminder on the due date.
--
-- Notifications
--  * Events add rows to public.notifications. The `push` Edge Function sends
--    them (in the recipient's language) and is called every minute by
--    pg_cron; see README "Push notifications".

-- ---------------------------------------------------------------------------
-- Loans: automatic reminder flag
-- ---------------------------------------------------------------------------

alter table public.loans add column auto_remind boolean not null default false;
grant insert (auto_remind), update (auto_remind) on public.loans to authenticated;

-- What the recipient calls the other person of this loan.
create or replace function public.party_label(l public.loans, recipient uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when recipient = l.creator_id then l.counterparty_name
    else coalesce((select display_name from public.profiles where id = l.creator_id), l.counterparty_name)
  end
$$;

-- ---------------------------------------------------------------------------
-- Notification queue
-- ---------------------------------------------------------------------------

create table public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null,
  data        jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  attempts    integer not null default 0,
  last_error  text
);
create index notifications_unsent_idx on public.notifications (id) where sent_at is null;
alter table public.notifications enable row level security; -- no policies: server only
revoke all on public.notifications from anon, authenticated;

create or replace function public.notify(p_user uuid, p_kind text, p_data jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, data)
  select p_user, p_kind, p_data
  where p_user is not null and p_user is distinct from auth.uid()
$$;
revoke execute on function public.notify(uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Push tokens
-- ---------------------------------------------------------------------------

create table public.push_tokens (
  token       text primary key check (char_length(token) between 10 and 300),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  platform    text not null check (platform in ('ios', 'android', 'web')),
  updated_at  timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
create policy "push_tokens: read own" on public.push_tokens for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.push_tokens from anon, authenticated;
grant select on public.push_tokens to authenticated;

-- A phone's token moves to whoever is signed in on it.
create or replace function public.register_push_token(p_token text, p_platform text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (p_token, auth.uid(), p_platform, now())
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now()
$$;

create or replace function public.unregister_push_token(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens where token = p_token and user_id = auth.uid()
$$;

revoke execute on function public.register_push_token(text, text) from public, anon;
revoke execute on function public.unregister_push_token(text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.unregister_push_token(text) to authenticated;

-- Used by the push Edge Function (service role only): take a batch of unsent
-- notifications with the recipient's language and phones.
create or replace function public.claim_notifications(p_limit integer default 100)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with batch as (
    update public.notifications n
       set attempts = n.attempts + 1
     where n.id in (
       select id from public.notifications
        where sent_at is null and attempts < 5
        order by id
        limit p_limit
        for update skip locked)
    returning n.id, n.user_id, n.kind, n.data
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'kind', b.kind,
    'data', b.data,
    'language', p.language,
    'tokens', coalesce((select jsonb_agg(t.token) from public.push_tokens t where t.user_id = b.user_id), '[]'::jsonb)
  ) order by b.id), '[]'::jsonb)
  from batch b join public.profiles p on p.id = b.user_id
$$;

create or replace function public.complete_notifications(p_sent bigint[], p_failed jsonb, p_dead_tokens text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notifications set sent_at = now(), last_error = null where id = any (p_sent);
  update public.notifications n set last_error = f.value
    from jsonb_each_text(coalesce(p_failed, '{}'::jsonb)) f
   where n.id = f.key::bigint;
  delete from public.push_tokens where token = any (p_dead_tokens);
  -- Keep the queue small.
  delete from public.notifications where sent_at < now() - interval '30 days' or (attempts >= 5 and created_at < now() - interval '30 days');
end;
$$;

revoke execute on function public.claim_notifications(integer) from public, anon, authenticated;
revoke execute on function public.complete_notifications(bigint[], jsonb, text[]) from public, anon, authenticated;
do $$
begin
  if exists (select from pg_roles where rolname = 'service_role') then
    grant execute on function public.claim_notifications(integer) to service_role;
    grant execute on function public.complete_notifications(bigint[], jsonb, text[]) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Repayments
-- ---------------------------------------------------------------------------

create table public.repayments (
  id                uuid primary key default gen_random_uuid(),
  loan_id           uuid not null references public.loans (id) on delete cascade,
  amount_minor      bigint not null check (amount_minor > 0 and amount_minor <= 9007199254740991),
  paid_on           date not null default current_date,
  note              text not null default '' check (char_length(note) <= 300),
  created_by        uuid default auth.uid() references public.profiles (id) on delete set null,
  status            text not null default 'pending' check (status in ('pending', 'confirmed', 'disputed', 'cancelled')),
  responded_by      uuid references public.profiles (id) on delete set null,
  responded_at      timestamptz,
  response_comment  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index repayments_loan_idx on public.repayments (loan_id);
create index repayments_updated_at_idx on public.repayments (updated_at);

alter table public.disputes
  add constraint disputes_repayment_fk foreign key (repayment_id) references public.repayments (id) on delete cascade;

-- Disputes about a repayment are visible to the parties of its record too.
drop policy "disputes: parties can read" on public.disputes;
create policy "disputes: parties can read"
  on public.disputes for select
  to authenticated
  using (public.is_loan_party(coalesce(loan_id, (select r.loan_id from public.repayments r where r.id = repayment_id))));

-- Common payload for a loan, from the recipient's point of view.
create or replace function public.loan_payload(l public.loans, recipient uuid, extra jsonb default '{}')
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'loan_id', l.id,
    'name', public.party_label(l, recipient),
    'amount_minor', l.amount_minor,
    'currency', l.currency,
    'remaining_minor', l.amount_minor - coalesce((
      select sum(r.amount_minor) from public.repayments r where r.loan_id = l.id and r.status = 'confirmed'), 0)
  ) || extra
$$;

-- Amount already paid back (confirmed), optionally counting repayments waiting for an answer.
create or replace function public.loan_repaid(p_loan_id uuid, p_include_pending boolean)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(amount_minor), 0)::bigint
  from public.repayments
  where loan_id = p_loan_id
    and (status = 'confirmed' or (p_include_pending and status = 'pending'))
$$;

-- Mark a record settled once confirmed repayments cover it.
create or replace function public.settle_if_repaid(p_loan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.loans;
begin
  select * into l from public.loans where id = p_loan_id for update;
  if l.status = 'confirmed' and public.loan_repaid(l.id, false) >= l.amount_minor then
    perform set_config('iou.internal_change', 'on', true);
    update public.loans set status = 'settled' where id = l.id;
    perform set_config('iou.internal_change', '', true);
    select * into l from public.loans where id = p_loan_id;
    perform public.notify(l.lender_id, 'settled', public.loan_payload(l, l.lender_id));
    perform public.notify(l.borrower_id, 'settled', public.loan_payload(l, l.borrower_id));
  end if;
end;
$$;

create or replace function public.repayments_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.loans;
begin
  select * into l from public.loans where id = new.loan_id for update;
  if not found then
    raise exception 'record not found' using errcode = 'foreign_key_violation';
  end if;
  if coalesce(current_setting('iou.internal_change', true), '') <> 'on' then
    new.created_by := auth.uid();
  end if;
  if l.status <> 'confirmed' then
    raise exception 'repayments can only be added to a confirmed record' using errcode = 'check_violation';
  end if;
  if public.loan_repaid(l.id, true) + new.amount_minor > l.amount_minor then
    raise exception 'more than what is still open' using errcode = 'check_violation';
  end if;
  new.note := btrim(new.note);
  new.created_at := now();
  new.updated_at := now();
  if new.created_by is not distinct from l.lender_id then
    -- The receiver says they got the money: nothing to confirm.
    new.status := 'confirmed';
    new.responded_by := new.created_by;
    new.responded_at := now();
  else
    new.status := 'pending';
    new.responded_by := null;
    new.responded_at := null;
  end if;
  new.response_comment := null;
  return new;
end;
$$;

create trigger repayments_before_insert
  before insert on public.repayments
  for each row execute function public.repayments_before_insert();

create or replace function public.repayments_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.loans;
  extra jsonb := jsonb_build_object('repayment_id', new.id, 'repayment_minor', new.amount_minor, 'paid_on', new.paid_on);
begin
  select * into l from public.loans where id = new.loan_id;
  if new.status = 'confirmed' then
    perform public.notify(l.borrower_id, 'repayment_recorded', public.loan_payload(l, l.borrower_id, extra));
    perform public.settle_if_repaid(l.id);
  else
    perform public.notify(l.lender_id, 'repayment_new', public.loan_payload(l, l.lender_id, extra));
    if l.lender_id is null then
      -- The lender answers through the share link: give it a fresh 30 days.
      perform set_config('iou.internal_change', 'on', true);
      update public.loans set share_expires_at = now() + interval '30 days' where id = l.id;
      perform set_config('iou.internal_change', '', true);
    end if;
  end if;
  return null;
end;
$$;

create trigger repayments_after_insert
  after insert on public.repayments
  for each row execute function public.repayments_after_insert();

-- The app may only cancel its own pending repayment; answers go through functions.
create or replace function public.repayments_before_update()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('iou.internal_change', true), '') <> 'on' then
    if old.status <> 'pending' or new.status <> 'cancelled' or old.created_by is distinct from auth.uid() then
      raise exception 'only your own pending repayment can be cancelled' using errcode = 'insufficient_privilege';
    end if;
    if (new.amount_minor, new.paid_on, new.note, new.loan_id) is distinct from (old.amount_minor, old.paid_on, old.note, old.loan_id) then
      raise exception 'repayments cannot be edited' using errcode = 'insufficient_privilege';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger repayments_before_update
  before update on public.repayments
  for each row execute function public.repayments_before_update();

-- A loan's amount can't drop below what has been (or may be) repaid, nor
-- change currency once repayments exist.
create or replace function public.loans_check_repayments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.amount_minor < public.loan_repaid(new.id, true) then
    raise exception 'the amount cannot be less than what was already paid back' using errcode = 'check_violation';
  end if;
  if new.currency <> old.currency and exists (
    select 1 from public.repayments where loan_id = new.id and status in ('pending', 'confirmed')) then
    raise exception 'the currency cannot change after repayments' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger loans_check_repayments
  before update of amount_minor, currency on public.loans
  for each row execute function public.loans_check_repayments();

alter table public.repayments enable row level security;

create policy "repayments: parties can read"
  on public.repayments for select to authenticated
  using (public.is_loan_party(loan_id));

create policy "repayments: parties can add"
  on public.repayments for insert to authenticated
  with check (public.is_loan_party(loan_id) and created_by = (select auth.uid()));

create policy "repayments: cancel own"
  on public.repayments for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

revoke all on public.repayments from anon, authenticated;
grant select on public.repayments to authenticated;
grant insert (id, loan_id, amount_minor, paid_on, note) on public.repayments to authenticated;
grant update (status) on public.repayments to authenticated;

-- Confirm or dispute a pending repayment (shared by the app and the link).
create or replace function public.apply_repayment_answer(p_rep public.repayments, p_action text, p_comment text, p_responder uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text := nullif(btrim(coalesce(p_comment, '')), '');
  l public.loans;
  new_status text := case when p_action = 'confirm' then 'confirmed' else 'disputed' end;
begin
  if p_action not in ('confirm', 'dispute') then
    raise exception 'unknown action' using errcode = 'invalid_parameter_value';
  end if;
  if p_rep.status <> 'pending' then
    raise exception 'this repayment is not waiting for an answer' using errcode = 'check_violation';
  end if;
  if p_action = 'dispute' then
    if clean is null or char_length(clean) > 500 then
      raise exception 'a comment of 1-500 characters is required' using errcode = 'check_violation';
    end if;
    insert into public.disputes (repayment_id, raised_by, comment) values (p_rep.id, p_responder, clean);
  end if;
  perform set_config('iou.internal_change', 'on', true);
  update public.repayments
     set status = new_status, responded_by = p_responder, responded_at = now(),
         response_comment = case when p_action = 'dispute' then clean end
   where id = p_rep.id;
  perform set_config('iou.internal_change', '', true);

  select * into l from public.loans where id = p_rep.loan_id;
  perform public.notify(p_rep.created_by, 'repayment_' || new_status, public.loan_payload(l, p_rep.created_by,
    jsonb_build_object('repayment_id', p_rep.id, 'repayment_minor', p_rep.amount_minor, 'comment', clean)));
  if p_action = 'confirm' then
    perform public.settle_if_repaid(l.id);
  end if;
  return new_status;
end;
$$;
revoke execute on function public.apply_repayment_answer(public.repayments, text, text, uuid) from public, anon, authenticated;

-- In the app: the lender answers a repayment the borrower recorded.
create or replace function public.respond_to_repayment(p_repayment_id uuid, p_action text, p_comment text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  r public.repayments;
  l public.loans;
begin
  select * into r from public.repayments where id = p_repayment_id for update;
  select * into l from public.loans where id = r.loan_id;
  if r.id is null or me is null or not coalesce(me = l.lender_id, false) or r.created_by is not distinct from me then
    raise exception 'only the lender can answer this repayment' using errcode = 'insufficient_privilege';
  end if;
  return public.apply_repayment_answer(r, p_action, p_comment, me);
end;
$$;
revoke execute on function public.respond_to_repayment(uuid, text, text) from public, anon;
grant execute on function public.respond_to_repayment(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Share link: also open while a repayment waits for a lender without an account
-- ---------------------------------------------------------------------------

create or replace function public.share_link_open(l public.loans)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select l.share_expires_at > now() and (
    l.status in ('pending', 'disputed')
    or (l.status = 'confirmed' and l.lender_id is null and exists (
      select 1 from public.repayments r where r.loan_id = l.id and r.status = 'pending'))
  )
$$;

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
    if not public.rate_limit_hit('miss:' || ip, 20, 3600) then
      return jsonb_build_object('error', 'rate_limited');
    end if;
    return jsonb_build_object('error', 'not_found');
  end if;

  select * into creator from public.profiles where id = l.creator_id;

  if not public.share_link_open(l) then
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
    'version', l.version,
    'repaid_minor', public.loan_repaid(l.id, false),
    -- Repayments the visitor (a lender without an account) is asked to confirm.
    'repayments', case when l.lender_id is null then coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'amount_minor', r.amount_minor, 'paid_on', r.paid_on, 'note', r.note) order by r.created_at)
      from public.repayments r where r.loan_id = l.id and r.status = 'pending'), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

create or replace function public.respond_shared_repayment(p_token text, p_repayment_id uuid, p_action text, p_comment text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ip text := public.request_ip();
  l public.loans;
  r public.repayments;
  status text;
begin
  if not public.rate_limit_hit('answer:' || ip, 20, 3600) then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  select * into l from public.loans where share_token = p_token;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if not public.rate_limit_hit('answer-token:' || p_token, 10, 3600) then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  select * into r from public.repayments where id = p_repayment_id and loan_id = l.id for update;
  -- Only a lender without an account answers through the link.
  if r.id is null or l.lender_id is not null or not public.share_link_open(l) then
    return jsonb_build_object('error', 'closed');
  end if;
  perform set_config('iou.actor', 'link', true);
  status := public.apply_repayment_answer(r, p_action, p_comment, null);
  perform set_config('iou.actor', '', true);
  return jsonb_build_object('status', status);
exception
  when check_violation or invalid_parameter_value then
    return jsonb_build_object('error', 'invalid');
end;
$$;
grant execute on function public.respond_shared_repayment(text, uuid, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Notifications for answers and changes on records
-- ---------------------------------------------------------------------------

create or replace function public.loans_notify_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The other person answered: tell the creator.
  if new.status in ('confirmed', 'disputed') and old.status is distinct from new.status and old.status <> 'settled' then
    perform public.notify(new.creator_id, 'loan_' || new.status, public.loan_payload(new, new.creator_id,
      jsonb_build_object('comment', nullif(current_setting('iou.comment', true), ''))));
  end if;
  -- The creator changed agreed terms: ask the other person (if they have an account) again.
  if new.status = 'pending' and old.status in ('confirmed', 'disputed') then
    perform public.notify(
      case when new.creator_id = new.lender_id then new.borrower_id else new.lender_id end,
      'loan_changed',
      public.loan_payload(new, case when new.creator_id = new.lender_id then new.borrower_id else new.lender_id end));
  end if;
  return null;
end;
$$;

create trigger loans_notify_changes
  after update of status on public.loans
  for each row execute function public.loans_notify_changes();

-- ---------------------------------------------------------------------------
-- Reminders
-- ---------------------------------------------------------------------------

create table public.reminders (
  id       bigint generated always as identity primary key,
  loan_id  uuid not null references public.loans (id) on delete cascade,
  sent_by  uuid references public.profiles (id) on delete set null, -- null: automatic
  tone     text not null check (tone in ('gentle', 'neutral', 'firm')),
  channel  text not null check (channel in ('push', 'share', 'auto')),
  sent_at  timestamptz not null default now()
);
create index reminders_loan_idx on public.reminders (loan_id, sent_at desc);
alter table public.reminders enable row level security;
create policy "reminders: parties can read" on public.reminders for select to authenticated using (public.is_loan_party(loan_id));
revoke all on public.reminders from anon, authenticated;
grant select on public.reminders to authenticated;

-- The lender sends a reminder: as a notification if the borrower has the app
-- ('push'), or through their own messenger ('share', the app opens the share
-- sheet). At most one per 48 hours per record, so nobody gets nagged.
create or replace function public.send_reminder(p_loan_id uuid, p_tone text, p_channel text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  l public.loans;
  last_at timestamptz;
  borrower_name text;
begin
  select * into l from public.loans where id = p_loan_id for update;
  if not found or me is null or not coalesce(me = l.lender_id, false) then
    raise exception 'only the lender can send reminders' using errcode = 'insufficient_privilege';
  end if;
  if p_tone not in ('gentle', 'neutral', 'firm') or p_channel not in ('push', 'share') then
    raise exception 'invalid reminder' using errcode = 'invalid_parameter_value';
  end if;
  if l.status <> 'confirmed' or public.loan_repaid(l.id, false) >= l.amount_minor then
    return jsonb_build_object('error', 'not_open');
  end if;
  if p_channel = 'push' and l.borrower_id is null then
    return jsonb_build_object('error', 'no_account');
  end if;
  select max(sent_at) into last_at from public.reminders
   where loan_id = l.id and channel in ('push', 'share');
  if last_at > now() - interval '48 hours' then
    return jsonb_build_object('error', 'too_soon', 'next_at', last_at + interval '48 hours');
  end if;

  insert into public.reminders (loan_id, sent_by, tone, channel) values (l.id, me, p_tone, p_channel);
  if p_channel = 'push' then
    select display_name into borrower_name from public.profiles where id = l.borrower_id;
    perform public.notify(l.borrower_id, 'reminder', public.loan_payload(l, l.borrower_id,
      jsonb_build_object('tone', p_tone, 'greet_name', borrower_name, 'loan_date', l.loan_date, 'due_date', l.due_date)));
  end if;
  return jsonb_build_object('ok', true, 'next_at', now() + interval '48 hours');
end;
$$;
revoke execute on function public.send_reminder(uuid, text, text) from public, anon;
grant execute on function public.send_reminder(uuid, text, text) to authenticated;

-- Daily job: records due today with automatic reminders on.
-- The borrower (if they have the app) gets a gentle reminder; the lender is
-- told it's due (and, if the borrower has no account, can send one themselves).
create or replace function public.run_due_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.loans;
  n integer := 0;
  borrower_name text;
begin
  for l in
    select * from public.loans
     where due_date = current_date and auto_remind and status = 'confirmed'
       and public.loan_repaid(id, false) < amount_minor
       and not exists (select 1 from public.reminders r where r.loan_id = loans.id and r.channel = 'auto' and r.sent_at::date = current_date)
  loop
    insert into public.reminders (loan_id, sent_by, tone, channel) values (l.id, null, 'gentle', 'auto');
    if l.borrower_id is not null then
      select display_name into borrower_name from public.profiles where id = l.borrower_id;
      perform public.notify(l.borrower_id, 'reminder', public.loan_payload(l, l.borrower_id,
        jsonb_build_object('tone', 'gentle', 'greet_name', borrower_name, 'loan_date', l.loan_date, 'due_date', l.due_date)));
    end if;
    perform public.notify(l.lender_id, 'due_today', public.loan_payload(l, l.lender_id,
      jsonb_build_object('borrower_has_app', l.borrower_id is not null)));
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.run_due_reminders() from public, anon, authenticated;

-- Schedule it daily at 06:00 UTC (09:30 in Tehran) where pg_cron exists (Supabase).
do $$
begin
  if exists (select from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('iou-due-reminders', '0 6 * * *', 'select public.run_due_reminders()');
  end if;
exception when others then
  raise notice 'pg_cron not available, schedule run_due_reminders() yourself: %', sqlerrm;
end $$;
