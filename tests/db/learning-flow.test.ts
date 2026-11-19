// Learning: a quiz that has no questions yet must not block or fail anyone,
// and an employee cannot keep re-taking a quiz they already passed.
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createDb, asUser, USERS } from './harness'

let db: PGlite
let course: string, lessonA: string, lessonB: string, emptyQuiz: string, quiz: string, rightAnswers: Record<string, string>

beforeAll(async () => {
  db = await createDb()
  const one = async (sql: string, p: unknown[] = []) => (await db.query<any>(sql, p)).rows[0]
  const org = (await one(`select organisation_id from employees limit 1`)).organisation_id
  course = (await one(`insert into courses (organisation_id, title, status, certificate_enabled) values ($1, 'Profile projector basics', 'published', true) returning id`, [org])).id
  const mod = (await one(`insert into course_modules (course_id, title, sort_order) values ($1, 'Intro', 1) returning id`, [course])).id
  lessonA = (await one(`insert into course_lessons (module_id, title, sort_order) values ($1, 'Lesson A', 1) returning id`, [mod])).id
  lessonB = (await one(`insert into course_lessons (module_id, title, sort_order) values ($1, 'Lesson B', 2) returning id`, [mod])).id
  // HR creates the quiz first and adds questions later — for now it is empty
  emptyQuiz = (await one(`insert into assessments (course_id, title, kind, max_attempts) values ($1, 'Draft quiz', 'quiz', 2) returning id`, [course])).id
})

describe('quiz with no questions yet', () => {
  it('cannot be submitted, so it does not use up attempts or score 0%', async () => {
    await asUser(db, USERS.employee, async (q) => {
      await q(`select enrol_in_course($1)`, [course])
      await expect(q(`select submit_assessment($1, '{}'::jsonb)`, [emptyQuiz])).rejects.toThrow(/no questions/i)
    })
    const n = (await db.query<any>(`select count(*)::int n from assessment_results where assessment_id = $1`, [emptyQuiz])).rows[0].n
    expect(n).toBe(0)
  })
  it('does not stop the course completing when all lessons are done', async () => {
    await asUser(db, USERS.employee, async (q) => {
      await q(`select complete_lesson($1)`, [lessonA])
      const [r] = await q<any>(`select complete_lesson($1) p`, [lessonB])
      expect(r.p).toBe(100)
      const [e] = await q<any>(`select status from course_enrolments where course_id = $1 and employee_id = current_employee_id()`, [course])
      expect(e.status).toBe('completed')
    })
  })
})

describe('quiz with questions', () => {
  beforeAll(async () => {
    quiz = (await db.query<any>(`insert into assessments (course_id, title, kind, max_attempts, passing_score) values ($1, 'Final quiz', 'quiz', 2, 50) returning id`, [course])).rows[0].id
    rightAnswers = {}
    for (const i of [1, 2]) {
      const qid = (await db.query<any>(`insert into assessment_questions (assessment_id, question, sort_order) values ($1, $2, $3) returning id`, [quiz, `Q${i}`, i])).rows[0].id
      const right = (await db.query<any>(`insert into assessment_options (question_id, option_text, is_correct, sort_order) values ($1, 'right', true, 1) returning id`, [qid])).rows[0].id
      await db.query(`insert into assessment_options (question_id, option_text, is_correct, sort_order) values ($1, 'wrong', false, 2)`, [qid])
      rightAnswers[qid] = right
    }
  })
  it('passing a quiz once is enough — it cannot be retaken', async () => {
    await asUser(db, USERS.employee, async (q) => {
      const [r] = await q<any>(`select submit_assessment($1, $2::jsonb) r`, [quiz, JSON.stringify(rightAnswers)])
      expect(r.r.passed).toBe(true)
      await expect(q(`select submit_assessment($1, '{}'::jsonb)`, [quiz])).rejects.toThrow(/already passed/i)
      const [e] = await q<any>(`select status, progress from course_enrolments where course_id = $1 and employee_id = current_employee_id()`, [course])
      expect(e.status).toBe('completed')
      expect(e.progress).toBe(100)
    })
  })
})
