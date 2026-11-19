-- Appraisal review fixes
-- 1) Rating only some goals produced a weighted score from those alone (one 5/5 -> perfect 5.00). Every active /
--    completed goal must now be rated.
-- 2) Dropped goals could be rated and counted. They are ignored.
-- 3) The overall rating was not checked against the scale (9 on a 1-5 scale was accepted).
-- 4) HR could finalise before the manager review was submitted.

create or replace function public.submit_appraisal_review(p_review uuid, p_ratings jsonb, p_overall int, p_strengths text, p_improvements text, p_comments text) returns numeric
language plpgsql security definer set search_path = public as $$
declare rv public.appraisal_reviews; v_me uuid := public.current_employee_id(); x jsonb; v_score numeric; v_max int; v_goals int; v_rated int; c public.appraisal_cycles; v_final uuid;
begin
  select * into rv from public.appraisal_reviews where id = p_review for update;
  if not found then raise exception 'Review not found'; end if;
  select * into c from public.appraisal_cycles where id = rv.cycle_id;
  if c.status <> 'in_review' then raise exception 'This cycle is not open for reviews'; end if;
  if rv.status = 'submitted' then raise exception 'This review has already been submitted'; end if;
  if rv.stage = 'self' and rv.employee_id <> v_me then raise exception 'Only the employee can submit a self assessment' using errcode = '42501'; end if;
  if rv.stage = 'manager' and not (public.is_subordinate(rv.employee_id, v_me) or public.has_permission('performance.manage')) then
    raise exception 'Only the reporting manager can submit this review' using errcode = '42501';
  end if;
  if rv.stage = 'hr' and not public.has_permission('performance.manage') then raise exception 'Only HR can submit this review' using errcode = '42501'; end if;
  if rv.stage = 'hr' and exists (select 1 from public.appraisal_reviews where cycle_id = rv.cycle_id and employee_id = rv.employee_id and stage = 'manager' and status = 'pending') then
    raise exception 'Submit the manager review before the HR review';
  end if;
  if rv.stage = 'manager' and exists (select 1 from public.appraisal_reviews where cycle_id = rv.cycle_id and employee_id = rv.employee_id and stage = 'self' and status = 'pending')
     and current_date <= coalesce(c.self_review_due, c.period_end) then
    raise exception 'Waiting for the employee''s self assessment';
  end if;
  select coalesce(max(value), 5) into v_max from public.rating_scale_levels where scale_id = c.rating_scale_id;
  if p_overall is not null and (p_overall < 1 or p_overall > v_max) then raise exception 'Overall rating must be between 1 and %', v_max; end if;
  delete from public.appraisal_ratings where review_id = p_review;
  for x in select * from jsonb_array_elements(coalesce(p_ratings, '[]'::jsonb)) loop
    if (x->>'rating')::int < 1 or (x->>'rating')::int > v_max then raise exception 'Ratings must be between 1 and %', v_max; end if;
    insert into public.appraisal_ratings(review_id, goal_id, rating, comment)
    select p_review, g.id, (x->>'rating')::int, x->>'comment' from public.performance_goals g
    where g.id = (x->>'goal_id')::uuid and g.employee_id = rv.employee_id and g.cycle_id = rv.cycle_id and g.status <> 'dropped';
  end loop;
  -- every live goal must be rated, otherwise the weighted score only reflects the goals someone chose to rate
  select count(*) into v_goals from public.performance_goals where cycle_id = rv.cycle_id and employee_id = rv.employee_id and status in ('active','completed');
  select count(*) into v_rated from public.appraisal_ratings ar join public.performance_goals g on g.id = ar.goal_id
   where ar.review_id = p_review and g.status in ('active','completed');
  if v_goals > 0 and v_rated < v_goals then raise exception 'Rate every goal before submitting (% of % rated)', v_rated, v_goals; end if;
  select round(sum(ar.rating * g.weight) / nullif(sum(g.weight), 0), 2) into v_score
    from public.appraisal_ratings ar join public.performance_goals g on g.id = ar.goal_id where ar.review_id = p_review;
  update public.appraisal_reviews set status = 'submitted', submitted_at = now(), weighted_score = v_score,
    overall_rating = coalesce(p_overall, round(v_score)::int), strengths = p_strengths, improvements = p_improvements, comments = p_comments,
    reviewer_employee_id = coalesce(reviewer_employee_id, v_me)
  where id = p_review;
  if rv.stage = 'self' then
    perform public.notify(public.employee_user_id((select reporting_manager_id from public.employees where id = rv.employee_id)), 'performance', 'appraisal.manager_due',
      jsonb_build_object('title', 'Review ' || public.employee_name(rv.employee_id) || ' for ' || c.name), '/performance/manager');
  elsif rv.stage = 'hr' then
    insert into public.appraisal_finals(cycle_id, employee_id, final_score, final_rating)
    values (rv.cycle_id, rv.employee_id, v_score, coalesce(p_overall, round(v_score)::int))
    on conflict (cycle_id, employee_id) do update set final_score = excluded.final_score, final_rating = excluded.final_rating, status = 'pending'
    returning id into v_final;
    perform public.submit_for_approval('appraisal', v_final, rv.employee_id, 'Appraisal result · ' || public.employee_name(rv.employee_id),
      c.name || ' · rating ' || coalesce(p_overall, round(v_score)::int));
  end if;
  return v_score;
end $$;
