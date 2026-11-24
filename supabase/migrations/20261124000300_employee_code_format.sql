-- Employee codes: configurable format (prefix + zero-padded number, e.g. AIM001), editable per employee,
-- and a one-off renumber for existing staff.

alter table public.company_settings
  add column if not exists employee_code_prefix text not null default 'EMP',
  add column if not exists employee_code_digits int  not null default 4 check (employee_code_digits between 1 and 8),
  add column if not exists employee_code_next   int  not null default 1001 check (employee_code_next >= 0);

-- carry on from today's numbering (EMPnnnn) so nothing changes until HR picks a new format
update public.company_settings cs set employee_code_next = greatest(cs.employee_code_next, coalesce((
  select max(substring(e.employee_code from '^EMP([0-9]+)$')::int) + 1 from public.employees e
  where e.organisation_id = cs.organisation_id and e.employee_code ~ '^EMP[0-9]+$'), 0));

create or replace function public.format_employee_code(p_prefix text, p_digits int, p_n int) returns text
language sql immutable as $$
  select coalesce(p_prefix, '') || case when length(p_n::text) >= p_digits then p_n::text else lpad(p_n::text, p_digits, '0') end
$$;

-- new employees without a code get the next free one in the company's format
create or replace function public.employees_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare cs public.company_settings; v_n int; v_code text;
begin
  new.employee_code := nullif(trim(coalesce(new.employee_code, '')), '');
  if new.employee_code is not null then return new; end if;
  select * into cs from public.company_settings where organisation_id = new.organisation_id for update;
  if not found then
    new.employee_code := 'EMP' || nextval('public.employee_code_seq');
    return new;
  end if;
  v_n := cs.employee_code_next;
  loop
    v_code := public.format_employee_code(cs.employee_code_prefix, cs.employee_code_digits, v_n);
    exit when not exists (select 1 from public.employees where organisation_id = new.organisation_id and employee_code = v_code);
    v_n := v_n + 1;
  end loop;
  new.employee_code := v_code;
  update public.company_settings set employee_code_next = v_n + 1 where organisation_id = new.organisation_id;
  return new;
end $$;

-- editing a code: trimmed, and it can't be blanked out
create or replace function public.employees_code_guard() returns trigger
language plpgsql as $$
begin
  new.employee_code := trim(coalesce(new.employee_code, ''));
  if new.employee_code = '' then new.employee_code := old.employee_code; end if;
  return new;
end $$;
drop trigger if exists trg_employees_code_guard on public.employees;
create trigger trg_employees_code_guard before update of employee_code on public.employees
  for each row execute function public.employees_code_guard();

-- renumber everyone (by joining date, then current code) in the given format; also saves the format
-- so the next new employee continues the sequence. Payslip numbers already issued keep their old code.
create or replace function public.renumber_employee_codes(p_prefix text, p_digits int, p_start int, p_include_exited boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.current_org_id(); v_n int := p_start; r record; v_count int := 0;
begin
  if not public.has_permission('employees.manage') then raise exception 'Not authorised' using errcode = '42501'; end if;
  if p_digits not between 1 and 8 or p_start < 0 then raise exception 'Digits must be 1–8 and the start number 0 or more'; end if;
  p_prefix := trim(coalesce(p_prefix, ''));
  -- step 1: move everyone affected to a temporary code so the new codes never clash with old ones
  update public.employees set employee_code = '~tmp~' || id::text
   where organisation_id = v_org and (p_include_exited or status <> 'exited');
  for r in select id from public.employees
            where organisation_id = v_org and employee_code like '~tmp~%'
            order by date_of_joining, created_at loop
    while exists (select 1 from public.employees where organisation_id = v_org
                   and employee_code = public.format_employee_code(p_prefix, p_digits, v_n)) loop
      v_n := v_n + 1;
    end loop;
    update public.employees set employee_code = public.format_employee_code(p_prefix, p_digits, v_n) where id = r.id;
    v_n := v_n + 1; v_count := v_count + 1;
  end loop;
  update public.company_settings set employee_code_prefix = p_prefix, employee_code_digits = p_digits, employee_code_next = v_n
   where organisation_id = v_org;
  return v_count;
end $$;
grant execute on function public.renumber_employee_codes(text, int, int, boolean) to authenticated;
