-- Engagement fixes
-- 1. Anonymous surveys: the answer record only keeps the date, never the exact time, so it can't be
--    matched to the "who responded" record (which shares the transaction's timestamp). Existing data is scrubbed.
-- 2. Policies: when HR changes the policy version, everyone's read/acknowledgement is cleared so they
--    must acknowledge the new version.

create or replace function public.submit_survey(p_survey uuid, p_answers jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s public.surveys; v_emp uuid := public.current_employee_id(); v_resp uuid; q public.survey_questions; v text;
begin
  select * into s from public.surveys where id = p_survey and organisation_id = public.current_org_id();
  if not found or s.status <> 'active' or current_date not between s.starts_on and s.ends_on then raise exception 'Survey is not open'; end if;
  insert into public.survey_participation(survey_id, employee_id) values (p_survey, v_emp);   -- PK blocks double voting
  insert into public.survey_responses(survey_id, employee_id, submitted_at)
  values (p_survey, case when s.is_anonymous then null else v_emp end,
          case when s.is_anonymous then date_trunc('day', now()) else now() end)
  returning id into v_resp;
  for q in select * from public.survey_questions where survey_id = p_survey loop
    v := p_answers->>(q.id::text);
    if q.is_required and coalesce(trim(v), '') = '' then raise exception 'Please answer: %', q.question; end if;
    if v is not null then
      insert into public.survey_answers(response_id, question_id, answer_text, answer_number)
      values (v_resp, q.id, v, case when q.question_type = 'rating' then v::numeric end);
    end if;
  end loop;
end $$;

-- scrub exact times already stored for anonymous surveys
update public.survey_responses r set submitted_at = date_trunc('day', r.submitted_at)
  from public.surveys s where s.id = r.survey_id and s.is_anonymous and r.submitted_at <> date_trunc('day', r.submitted_at);

create or replace function public.policy_version_reack() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.requires_acknowledgement and new.policy_version is distinct from old.policy_version then
    update public.announcement_recipients set read_at = null, acknowledged_at = null where announcement_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists trg_policy_version_reack on public.announcements;
create trigger trg_policy_version_reack after update of policy_version on public.announcements
  for each row execute function public.policy_version_reack();
