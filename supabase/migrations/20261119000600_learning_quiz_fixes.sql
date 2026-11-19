-- Learning fixes
-- 1. A quiz with no questions yet no longer counts: it can't be submitted (no 0% score, no lost attempts)
--    and it doesn't hold a course at 90%.
-- 2. A quiz that has already been passed can't be taken again.

create or replace function public.recalc_enrolment(p_enrolment uuid) returns void
language plpgsql security definer set search_path = public as $$
declare en public.course_enrolments; v_total int; v_done int; v_need_assess boolean; v_passed boolean; c public.courses;
begin
  select * into en from public.course_enrolments where id = p_enrolment;
  if en.status = 'completed' then return; end if;   -- completion (and its certificate) is never taken back
  select * into c from public.courses where id = en.course_id;
  select count(*) into v_total from public.course_lessons l join public.course_modules m on m.id = l.module_id where m.course_id = en.course_id;
  select count(*) into v_done from public.lesson_progress where enrolment_id = p_enrolment;
  -- only active quizzes that actually have questions are required
  v_need_assess := exists (select 1 from public.assessments a where a.course_id = en.course_id and a.is_active
                             and exists (select 1 from public.assessment_questions q where q.assessment_id = a.id));
  v_passed := not v_need_assess or not exists (
    select 1 from public.assessments a where a.course_id = en.course_id and a.is_active
      and exists (select 1 from public.assessment_questions q where q.assessment_id = a.id)
      and not exists (select 1 from public.assessment_results r where r.assessment_id = a.id and r.enrolment_id = p_enrolment and r.passed));
  update public.course_enrolments set
    progress = case when v_total = 0 then case when v_passed then 100 else 0 end
                    else least(100, round(100.0 * v_done / v_total * case when v_need_assess and not v_passed then 0.9 else 1 end)) end,
    status = case when v_done >= v_total and v_passed then 'completed'
                  when status = 'enrolled' and v_done > 0 then 'in_progress' else status end,
    started_at = coalesce(started_at, case when v_done > 0 then now() end),
    completed_at = case when v_done >= v_total and v_passed then coalesce(completed_at, now()) end
  where id = p_enrolment returning * into en;
  if en.status = 'completed' and c.certificate_enabled then
    insert into public.certificates(enrolment_id, certificate_number)
    values (p_enrolment, 'CERT-' || to_char(now(), 'YYYY') || '-' || upper(substr(replace(p_enrolment::text, '-', ''), 1, 8)))
    on conflict (enrolment_id) do nothing;
  end if;
end $$;

create or replace function public.submit_assessment(p_assessment uuid, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.assessments; v_en uuid; v_attempt int; v_total int; v_got int; v_score int; v_passed boolean;
begin
  select * into a from public.assessments where id = p_assessment and is_active;
  if not found then raise exception 'Assessment not found'; end if;
  select id into v_en from public.course_enrolments where course_id = a.course_id and employee_id = public.current_employee_id();
  if v_en is null then raise exception 'Enrol in this course first'; end if;
  if not exists (select 1 from public.assessment_questions where assessment_id = p_assessment) then
    raise exception 'This quiz has no questions yet. Please try again later.';
  end if;
  if exists (select 1 from public.assessment_results where assessment_id = p_assessment and enrolment_id = v_en and passed) then
    raise exception 'You have already passed this quiz';
  end if;
  select coalesce(max(attempt), 0) + 1 into v_attempt from public.assessment_results where assessment_id = p_assessment and enrolment_id = v_en;
  if v_attempt > a.max_attempts then raise exception 'No attempts left (maximum %)', a.max_attempts; end if;
  select coalesce(sum(points), 0) into v_total from public.assessment_questions where assessment_id = p_assessment;
  select coalesce(sum(q.points), 0) into v_got from public.assessment_questions q
    join public.assessment_options o on o.question_id = q.id and o.is_correct
   where q.assessment_id = p_assessment and o.id::text = p_answers->>(q.id::text);
  v_score := case when v_total = 0 then 0 else round(100.0 * v_got / v_total) end;
  v_passed := v_score >= a.passing_score;
  insert into public.assessment_results(assessment_id, enrolment_id, attempt, score, passed) values (p_assessment, v_en, v_attempt, v_score, v_passed);
  if not v_passed and v_attempt >= a.max_attempts then update public.course_enrolments set status = 'failed' where id = v_en; end if;
  perform public.recalc_enrolment(v_en);
  return jsonb_build_object('score', v_score, 'passed', v_passed, 'attempt', v_attempt, 'attempts_left', a.max_attempts - v_attempt);
end $$;

-- refresh anyone currently stuck at 90% because of an empty quiz
do $$ declare r record; begin
  for r in select id from public.course_enrolments where status in ('enrolled','in_progress') loop
    perform public.recalc_enrolment(r.id);
  end loop;
end $$;
