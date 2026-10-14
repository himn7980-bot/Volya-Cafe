-- Phase 2: loans and their immutable history.
--
-- Rules enforced here (not just in the app):
--  * Only the two parties of a loan can see it or its history.
--  * Only the creator can edit it. Edits never overwrite history: every change
--    bumps `version` and stores a full snapshot in loan_versions.
--  * Changing what was agreed (amount, currency, dates, note, photo) after the
--    other person confirmed or disputed puts the loan back to "pending", so it
--    has to be confirmed again.
--  * The app can only move a loan to "cancelled". Confirm / dispute / settle
--    happen through server functions added in later phases.
--  * Money is an integer number of minor units (cents, rials...), never float.

-- ---------------------------------------------------------------------------
-- Share tokens: 256 bits from two random UUIDs (minus their fixed bits, ~244
-- bits of randomness). gen_random_uuid() is built into PostgreSQL 13+.
-- ---------------------------------------------------------------------------

create or replace function public.new_share_token()
returns text
language sql
volatile
as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.loans (
  id                 uuid primary key default gen_random_uuid(),
  creator_id         uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  lender_id          uuid references public.profiles (id) on delete set null,
  borrower_id        uuid references public.profiles (id) on delete set null,
  counterparty_name  text not null check (char_length(btrim(counterparty_name)) between 1 and 80),
  counterparty_phone text check (counterparty_phone is null or counterparty_phone ~ '^\+[1-9][0-9]{6,14}$'),
  amount_minor       bigint not null check (amount_minor > 0 and amount_minor <= 9007199254740991),
  currency           text not null check (currency ~ '^[A-Z]{3}$'),
  note               text not null default '' check (char_length(note) <= 500),
  loan_date          date not null default current_date,
  due_date           date,
  photo_path         text,
  status             text not null default 'pending'
                     check (status in ('pending', 'confirmed', 'disputed', 'settled', 'cancelled')),
  share_token        text not null unique default public.new_share_token(),
  version            integer not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint loans_due_after_loan check (due_date is null or due_date >= loan_date),
  constraint loans_creator_is_party check (creator_id = lender_id or creator_id = borrower_id),
  constraint loans_parties_differ check (lender_id is distinct from borrower_id),
  constraint loans_photo_in_own_folder check (photo_path is null or photo_path like id::text || '/%')
);

comment on column public.loans.amount_minor is 'Amount in the currency''s minor unit (IRR: rial). Integer, never float.';
comment on column public.loans.counterparty_name is 'What the creator calls the other person. Private label, not their profile name.';

create index loans_creator_idx on public.loans (creator_id);
create index loans_lender_idx on public.loans (lender_id) where lender_id is not null;
create index loans_borrower_idx on public.loans (borrower_id) where borrower_id is not null;
create index loans_updated_at_idx on public.loans (updated_at);

create table public.loan_versions (
  id          bigint generated always as identity primary key,
  loan_id     uuid not null references public.loans (id) on delete cascade,
  version     integer not null,
  changed_by  uuid references public.profiles (id) on delete set null,
  snapshot    jsonb not null,
  created_at  timestamptz not null default now(),
  unique (loan_id, version)
);

comment on table public.loan_versions is 'Append-only history. One row per version of a loan, written by trigger.';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Is the signed-in user one of the two parties? SECURITY DEFINER so policies on
-- other tables (versions, storage) can use it without recursing into loans RLS.
create or replace function public.is_loan_party(p_loan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.loans l
    where l.id = p_loan_id
      and (select auth.uid()) in (l.creator_id, l.lender_id, l.borrower_id)
  )
$$;

-- Server functions in later phases set this to change status or parties.
create or replace function public.loans_internal_change()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('iou.internal_change', true), '') = 'on'
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function public.loans_before_insert()
returns trigger
language plpgsql
as $$
begin
  if not public.loans_internal_change() then
    new.creator_id := coalesce(auth.uid(), new.creator_id);
    new.status := 'pending';
  end if;
  new.counterparty_name := btrim(new.counterparty_name);
  new.version := 1;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

create trigger loans_before_insert
  before insert on public.loans
  for each row execute function public.loans_before_insert();

create or replace function public.loans_before_update()
returns trigger
language plpgsql
as $$
declare
  terms_changed boolean;
  label_changed boolean;
begin
  if new.id <> old.id or new.creator_id <> old.creator_id
     or new.share_token <> old.share_token or new.created_at <> old.created_at then
    raise exception 'loan identity fields cannot change' using errcode = 'check_violation';
  end if;

  new.counterparty_name := btrim(new.counterparty_name);

  terms_changed :=
       new.amount_minor is distinct from old.amount_minor
    or new.currency     is distinct from old.currency
    or new.note         is distinct from old.note
    or new.loan_date    is distinct from old.loan_date
    or new.due_date     is distinct from old.due_date
    or new.photo_path   is distinct from old.photo_path;
  label_changed :=
       new.counterparty_name  is distinct from old.counterparty_name
    or new.counterparty_phone is distinct from old.counterparty_phone;

  if not public.loans_internal_change() then
    if old.status in ('cancelled', 'settled') then
      raise exception 'this loan is closed and can no longer change' using errcode = 'check_violation';
    end if;
    if new.lender_id is distinct from old.lender_id or new.borrower_id is distinct from old.borrower_id then
      raise exception 'parties cannot be changed directly' using errcode = 'insufficient_privilege';
    end if;
    if new.status is distinct from old.status and new.status <> 'cancelled' then
      raise exception 'status can only be changed to cancelled' using errcode = 'insufficient_privilege';
    end if;
    -- Agreed terms changed: the other person must confirm again.
    if terms_changed and new.status <> 'cancelled' and old.status in ('confirmed', 'disputed') then
      new.status := 'pending';
    end if;
  end if;

  if terms_changed or label_changed
     or new.status is distinct from old.status
     or new.lender_id is distinct from old.lender_id
     or new.borrower_id is distinct from old.borrower_id then
    new.version := old.version + 1;
    new.updated_at := now();
  else
    -- Nothing that matters changed: keep the version.
    new.version := old.version;
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

create trigger loans_before_update
  before update on public.loans
  for each row execute function public.loans_before_update();

create or replace function public.loans_record_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.version <> old.version then
    insert into public.loan_versions (loan_id, version, changed_by, snapshot)
    values (new.id, new.version, coalesce(auth.uid(), new.creator_id), to_jsonb(new) - 'share_token');
  end if;
  return null;
end;
$$;

create trigger loans_record_version
  after insert or update on public.loans
  for each row execute function public.loans_record_version();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.loans enable row level security;
alter table public.loan_versions enable row level security;

create policy "loans: parties can read"
  on public.loans for select
  to authenticated
  using ((select auth.uid()) in (creator_id, lender_id, borrower_id));

create policy "loans: create as one of the parties"
  on public.loans for insert
  to authenticated
  with check (
    creator_id = (select auth.uid())
    and (
      (lender_id = (select auth.uid()) and borrower_id is null)
      or (borrower_id = (select auth.uid()) and lender_id is null)
    )
  );

create policy "loans: creator can edit"
  on public.loans for update
  to authenticated
  using (creator_id = (select auth.uid()))
  with check (creator_id = (select auth.uid()));

-- No delete policy: loans are cancelled, never deleted (history stays).

create policy "loan_versions: parties can read"
  on public.loan_versions for select
  to authenticated
  using (public.is_loan_party(loan_id));

revoke all on public.loans, public.loan_versions from anon, authenticated;
grant select on public.loans, public.loan_versions to authenticated;
grant insert (id, lender_id, borrower_id, counterparty_name, counterparty_phone, amount_minor,
              currency, note, loan_date, due_date)
  on public.loans to authenticated;
grant update (counterparty_name, counterparty_phone, amount_minor, currency, note, loan_date,
              due_date, photo_path, status)
  on public.loans to authenticated;

revoke execute on function public.loans_internal_change() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Receipt / transfer screenshots: private bucket, files under "<loan id>/"
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('loan-photos', 'loan-photos', false, 5 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create or replace function public.is_loan_creator_folder(p_folder text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.loans l
    where l.id::text = p_folder and l.creator_id = (select auth.uid())
  )
$$;

create or replace function public.is_loan_party_folder(p_folder text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.loans l
    where l.id::text = p_folder
      and (select auth.uid()) in (l.creator_id, l.lender_id, l.borrower_id)
  )
$$;

create policy "loan-photos: parties can read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'loan-photos' and public.is_loan_party_folder((storage.foldername(name))[1]));

create policy "loan-photos: creator can upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'loan-photos' and public.is_loan_creator_folder((storage.foldername(name))[1]));

create policy "loan-photos: creator can delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'loan-photos' and public.is_loan_creator_folder((storage.foldername(name))[1]));
