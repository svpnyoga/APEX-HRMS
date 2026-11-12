-- =====================================================================
-- 0007 EXPENSE & CLAIMS
-- =====================================================================
create table public.claim_categories (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  name text not null,
  code text,
  description text,
  receipt_required_above numeric(10,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organisation_id, name)
);

create table public.expense_policies (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  category_id uuid not null references public.claim_categories(id) on delete cascade,
  designation_id uuid references public.designations(id) on delete cascade,  -- null = everyone
  per_claim_limit numeric(12,2),
  monthly_limit numeric(12,2),
  max_days_after_expense int not null default 60,
  allow_exceed_with_justification boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.expense_claims (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  claim_number text not null,
  category_id uuid not null references public.claim_categories(id),
  title text not null,
  description text,
  expense_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  approved_amount numeric(12,2),
  currency text not null default 'INR',
  project_reference text,
  department_id uuid references public.departments(id),
  status text not null default 'draft' check (status in ('draft','submitted','approved','rejected','reimbursed','cancelled')),
  policy_violation text,
  justification text,
  is_possible_duplicate boolean not null default false,
  duplicate_of uuid references public.expense_claims(id),
  submitted_at timestamptz,
  decided_at timestamptz,
  rejection_reason text,
  reimbursement_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, claim_number)
);
create index on public.expense_claims(employee_id, expense_date);
create index on public.expense_claims(organisation_id, status);
create trigger trg_claims_updated before update on public.expense_claims for each row execute function public.set_updated_at();

create sequence public.claim_number_seq start 1;
create or replace function public.claims_before_insert() returns trigger language plpgsql as $$
begin
  if new.claim_number is null or new.claim_number = '' then
    new.claim_number := 'CLM-' || to_char(now(), 'YYMM') || '-' || lpad(nextval('public.claim_number_seq')::text, 5, '0');
  end if;
  return new;
end $$;
create trigger trg_claims_number before insert on public.expense_claims for each row execute function public.claims_before_insert();

create table public.claim_attachments (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.expense_claims(id) on delete cascade,
  storage_path text not null,           -- private bucket 'claim-receipts'
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  sha256 text,                          -- duplicate receipt detection
  uploaded_at timestamptz not null default now()
);
create index on public.claim_attachments(sha256);

create table public.reimbursements (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  batch_reference text not null,
  paid_on date not null default current_date,
  payment_mode text not null default 'bank_transfer' check (payment_mode in ('bank_transfer','cash','cheque','payroll')),
  total_amount numeric(14,2) not null default 0,
  claim_count int not null default 0,
  notes text,
  processed_by uuid,
  created_at timestamptz not null default now()
);
alter table public.expense_claims add constraint claims_reimb_fk foreign key (reimbursement_id) references public.reimbursements(id) on delete set null;

create view public.claim_approvals as
  select t.id, r.entity_id as claim_id, t.step_order, t.step_name, t.approver_user_id, t.status, t.comment, t.acted_at, t.created_at
  from public.approval_tasks t join public.approval_requests r on r.id = t.request_id
  where r.entity_type = 'expense_claim' and public.can_see_request(r.id);
grant select on public.claim_approvals to authenticated;

-- PUBLIC: submit a draft claim (validations: receipt, policy limits, duplicates, age)
create or replace function public.submit_claim(p_claim uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.expense_claims; cat public.claim_categories; pol public.expense_policies; e public.employees;
  v_month_total numeric; v_viol text[] := '{}'; v_dup uuid; v_att int;
begin
  select * into c from public.expense_claims where id = p_claim for update;
  if not found then raise exception 'Claim not found'; end if;
  if c.employee_id <> public.current_employee_id() then raise exception 'You can only submit your own claims' using errcode = '42501'; end if;
  if c.status not in ('draft','rejected') then raise exception 'Claim is already %', c.status; end if;
  select * into e from public.employees where id = c.employee_id;
  select * into cat from public.claim_categories where id = c.category_id;
  select count(*) into v_att from public.claim_attachments where claim_id = c.id;
  if c.amount > cat.receipt_required_above and v_att = 0 then
    raise exception 'A receipt is required for % claims above %', cat.name, cat.receipt_required_above;
  end if;
  if c.expense_date > current_date then raise exception 'Expense date cannot be in the future'; end if;

  select * into pol from public.expense_policies where category_id = c.category_id and is_active
    and (designation_id is null or designation_id = e.designation_id)
    order by designation_id nulls last limit 1;
  if pol.id is not null then
    if current_date - c.expense_date > pol.max_days_after_expense then
      raise exception 'Claims must be submitted within % days of the expense', pol.max_days_after_expense;
    end if;
    if pol.per_claim_limit is not null and c.amount > pol.per_claim_limit then
      v_viol := v_viol || format('Exceeds per-claim limit of %s', pol.per_claim_limit);
    end if;
    if pol.monthly_limit is not null then
      select coalesce(sum(amount), 0) into v_month_total from public.expense_claims
       where employee_id = c.employee_id and category_id = c.category_id and id <> c.id
         and status in ('submitted','approved','reimbursed') and date_trunc('month', expense_date) = date_trunc('month', c.expense_date);
      if v_month_total + c.amount > pol.monthly_limit then
        v_viol := v_viol || format('Exceeds monthly limit of %s (already %s)', pol.monthly_limit, v_month_total);
      end if;
    end if;
    if array_length(v_viol, 1) > 0 then
      if not pol.allow_exceed_with_justification then raise exception '%', array_to_string(v_viol, '; '); end if;
      if coalesce(trim(c.justification), '') = '' then raise exception '%. Add a justification to submit.', array_to_string(v_viol, '; '); end if;
    end if;
  end if;

  -- duplicate detection: same date+amount+category, or identical receipt file
  select id into v_dup from public.expense_claims where employee_id = c.employee_id and id <> c.id
     and status not in ('rejected','cancelled','draft') and category_id = c.category_id and expense_date = c.expense_date and amount = c.amount limit 1;
  if v_dup is null then
    select ec.id into v_dup from public.claim_attachments a1 join public.claim_attachments a2 on a2.sha256 = a1.sha256 and a2.claim_id <> a1.claim_id
      join public.expense_claims ec on ec.id = a2.claim_id and ec.status not in ('rejected','cancelled','draft')
     where a1.claim_id = c.id and a1.sha256 is not null limit 1;
  end if;

  update public.expense_claims set status = 'submitted', submitted_at = now(),
    policy_violation = nullif(array_to_string(v_viol, '; '), ''), is_possible_duplicate = v_dup is not null, duplicate_of = v_dup
  where id = c.id;
  perform public.submit_for_approval('expense_claim', c.id, c.employee_id, c.claim_number || ' · ' || c.title,
    cat.name || ' · ' || to_char(c.expense_date, 'DD Mon YYYY') || case when v_dup is not null then ' · possible duplicate' else '' end
      || case when array_length(v_viol,1) > 0 then ' · policy exception' else '' end, c.amount);
  return jsonb_build_object('possible_duplicate', v_dup is not null, 'policy_violation', array_to_string(v_viol, '; '));
end $$;

create or replace function public.approval_hook_expense_claim(p_id uuid, p_status text, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.expense_claims set
    status = case when p_status = 'approved' then 'approved' when p_status = 'rejected' then 'rejected' else 'draft' end,
    approved_amount = case when p_status = 'approved' then coalesce(approved_amount, amount) end,
    decided_at = now(), rejection_reason = case when p_status = 'rejected' then p_comment end
  where id = p_id;
end $$;

-- PUBLIC (claims.reimburse): pay a batch of approved claims
create or replace function public.reimburse_claims(p_claims uuid[], p_reference text, p_mode text default 'bank_transfer', p_paid_on date default current_date) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_total numeric; v_n int; c record;
begin
  if not public.has_permission('claims.reimburse') then raise exception 'Not authorised' using errcode = '42501'; end if;
  select count(*), coalesce(sum(coalesce(approved_amount, amount)), 0) into v_n, v_total
    from public.expense_claims where id = any(p_claims) and organisation_id = public.current_org_id() and status = 'approved';
  if v_n <> coalesce(array_length(p_claims, 1), 0) then raise exception 'Only approved claims can be reimbursed'; end if;
  insert into public.reimbursements(organisation_id, batch_reference, paid_on, payment_mode, total_amount, claim_count, processed_by)
  values (public.current_org_id(), p_reference, p_paid_on, p_mode, v_total, v_n, auth.uid()) returning id into v_id;
  update public.expense_claims set status = 'reimbursed', reimbursement_id = v_id where id = any(p_claims);
  for c in select ec.claim_number, e.user_id, coalesce(ec.approved_amount, ec.amount) amt from public.expense_claims ec join public.employees e on e.id = ec.employee_id where ec.id = any(p_claims) loop
    perform public.notify(c.user_id, 'claims', 'claim.reimbursed', jsonb_build_object('title', c.claim_number || ' reimbursed', 'amount', c.amt), '/me/claims');
  end loop;
  return v_id;
end $$;

-- ---------- RLS ----------
alter table public.claim_categories enable row level security;
alter table public.expense_policies enable row level security;
alter table public.expense_claims enable row level security;
alter table public.claim_attachments enable row level security;
alter table public.reimbursements enable row level security;

create policy cc_read on public.claim_categories for select to authenticated using (organisation_id = public.current_org_id());
create policy cc_write on public.claim_categories for all to authenticated
  using (organisation_id = public.current_org_id() and public.has_permission('claims.manage')) with check (organisation_id = public.current_org_id());
create policy ep_read on public.expense_policies for select to authenticated using (organisation_id = public.current_org_id());
create policy ep_write on public.expense_policies for all to authenticated
  using (organisation_id = public.current_org_id() and public.has_permission('claims.manage')) with check (organisation_id = public.current_org_id());

create policy claims_read on public.expense_claims for select to authenticated
  using (public.can_view_employee(employee_id, 'claims') or (public.has_permission('claims.reimburse') and organisation_id = public.current_org_id()));
create policy claims_insert on public.expense_claims for insert to authenticated
  with check (employee_id = public.current_employee_id() and organisation_id = public.current_org_id() and status = 'draft' and public.has_permission('claims.submit'));
create policy claims_update_draft on public.expense_claims for update to authenticated
  using (employee_id = public.current_employee_id() and status in ('draft','rejected'))
  with check (employee_id = public.current_employee_id() and status in ('draft','rejected','cancelled'));
create policy claims_delete_draft on public.expense_claims for delete to authenticated
  using (employee_id = public.current_employee_id() and status = 'draft');

create policy ca_read on public.claim_attachments for select to authenticated
  using (exists (select 1 from public.expense_claims c where c.id = claim_id));
create policy ca_insert on public.claim_attachments for insert to authenticated
  with check (exists (select 1 from public.expense_claims c where c.id = claim_id and c.employee_id = public.current_employee_id() and c.status in ('draft','rejected')));
create policy ca_delete on public.claim_attachments for delete to authenticated
  using (exists (select 1 from public.expense_claims c where c.id = claim_id and c.employee_id = public.current_employee_id() and c.status in ('draft','rejected')));

create policy reimb_read on public.reimbursements for select to authenticated
  using (organisation_id = public.current_org_id() and (public.has_permission('claims.reimburse') or public.has_permission('claims.view')));
