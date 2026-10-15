-- Deleting an account (Settings > Delete account, see the delete-account Edge
-- Function). Removing the auth user cascades to the profile; records this
-- person wrote are deleted with it, and records the other side wrote lose
-- their link to this person (on delete set null).
--
-- Those "set null" updates go through the loan and repayment triggers, which
-- refuse party changes from users. Mark the deletion as an internal change
-- for the rest of the transaction so the cascade can run.

create or replace function public.profiles_before_delete()
returns trigger
language plpgsql
as $$
begin
  perform set_config('iou.internal_change', 'on', true);
  return old;
end;
$$;

create trigger profiles_before_delete
  before delete on public.profiles
  for each row execute function public.profiles_before_delete();

revoke execute on function public.profiles_before_delete() from public, anon, authenticated;
