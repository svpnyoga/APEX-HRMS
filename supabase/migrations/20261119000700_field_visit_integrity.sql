-- Field visits: start and end times come from the server, not the phone.
-- An employee can have one open visit, can end it once, and can't rewrite it afterwards.
-- (Corrections by HR/admin through the SQL editor or service role are not affected.)

create or replace function public.field_visit_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.current_employee_id();
begin
  if v_me is null or v_me <> new.employee_id then return new; end if;   -- only the employee's own edits are restricted

  if tg_op = 'INSERT' then
    if exists (select 1 from public.field_visits where employee_id = new.employee_id and check_out_at is null) then
      raise exception 'You already have a visit in progress. End it before starting a new one.';
    end if;
    new.check_in_at := now();
    new.check_out_at := null;
    return new;
  end if;

  -- UPDATE
  if old.check_out_at is not null then
    raise exception 'This visit has already ended and cannot be changed.';
  end if;
  if new.check_in_at is distinct from old.check_in_at or new.employee_id is distinct from old.employee_id
     or new.check_in_lat is distinct from old.check_in_lat or new.check_in_lng is distinct from old.check_in_lng
     or new.organisation_id is distinct from old.organisation_id then
    raise exception 'The start of a visit cannot be changed.';
  end if;
  if new.check_out_at is not null then new.check_out_at := now(); end if;
  return new;
end $$;

drop trigger if exists trg_field_visit_guard on public.field_visits;
create trigger trg_field_visit_guard before insert or update on public.field_visits
  for each row execute function public.field_visit_guard();
