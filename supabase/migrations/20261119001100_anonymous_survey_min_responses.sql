-- Anonymous surveys: HR can only read answers once at least 3 people have responded,
-- so a single answer can't be traced to the only person who took part.

create or replace function public.survey_results_visible(p_survey uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not s.is_anonymous or (select count(*) from public.survey_participation p where p.survey_id = s.id) >= 3
  from public.surveys s where s.id = p_survey
$$;

drop policy if exists sa_read_admin on public.survey_answers;
create policy sa_read_admin on public.survey_answers for select to authenticated
  using (public.has_permission('engagement.manage')
         and exists (select 1 from public.survey_responses r where r.id = response_id and public.survey_results_visible(r.survey_id)));

drop policy if exists sr_read_admin on public.survey_responses;
create policy sr_read_admin on public.survey_responses for select to authenticated
  using (public.has_permission('engagement.manage') and public.survey_results_visible(survey_id)
         and exists (select 1 from public.surveys s where s.id = survey_id));
