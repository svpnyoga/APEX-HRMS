import { useConfirm } from '@/components/common/confirm'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { isWithinInterval, parseISO, startOfMonth, endOfMonth } from 'date-fns'
import { Award, BookOpen, CheckCircle2, Circle, Clock, Download, GraduationCap, ListChecks, Play, Plus, Send, Trash2, Users, ExternalLink, FileText, Video } from 'lucide-react'
import { toast } from 'sonner'
import { db, rpc, unwrap } from '@/lib/api'
import { useAuth, useMe } from '@/app/auth'
import { useAction, useLookup } from '@/hooks/data'
import { signedUrl } from '@/lib/storage'
import { DataTable, type Column } from '@/components/common/DataTable'
import { PageHeader, QueryView, StatStrip, EmptyState } from '@/components/common/page'
import { EmployeeCell, EmployeePicker } from '@/components/common/pickers'
import { StatusBadge } from '@/components/common/status'
import { MonthCalendar, MonthNav } from '@/components/common/calendar'
import { CrudPage } from '@/components/crud/CrudPage'
import { Button } from '@/components/ui/button'
import { Dialog, Drawer } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Badge, Card, CardHeader, Progress, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { cn, errorMessage, fmtDate, fmtDateTime, isoDate, minutes, titleCase } from '@/lib/utils'

const useRegister = (filter?: (q: any) => any, key = 'all') => useQuery({ queryKey: ['learning', 'reg', key], queryFn: async () => { let q: any = db.from('v_training_register').select('*').limit(5000); if (filter) q = filter(q); return unwrap<any[]>(q) } })

export function LmsDashboard() {
  const reg = useRegister()
  const courses = useQuery({ queryKey: ['learning', 'courses-count'], queryFn: () => unwrap<any[]>(db.from('courses').select('id, title, is_mandatory, status')) })
  const rows = reg.data ?? []
  const byCourse = Object.values(rows.reduce((m: Record<string, any>, r) => { const x = m[r.course_id] ?? { title: r.course_title, total: 0, done: 0, mandatory: r.is_mandatory }; x.total++; if (r.status === 'completed') x.done++; m[r.course_id] = x; return m }, {})) as any[]
  return (
    <div className="space-y-5">
      <PageHeader title="Learning dashboard" />
      <StatStrip items={[
        { label: 'Published courses', value: (courses.data ?? []).filter((c) => c.status === 'published').length, to: '/learning/library' }, { label: 'Enrolments', value: rows.length },
        { label: 'Completion rate', value: rows.length ? `${Math.round((rows.filter((r) => r.status === 'completed').length / rows.length) * 100)}%` : '—', tone: 'success' },
        { label: 'Overdue', value: rows.filter((r) => r.due_date && r.due_date < isoDate() && r.status !== 'completed').length, tone: 'danger', to: '/learning/progress' },
        { label: 'Certificates issued', value: rows.filter((r) => r.certificate_number).length, to: '/learning/certificates' },
      ]} />
      <Card><CardHeader title="Course completion" />
        <ul className="divide-y divide-line">{byCourse.map((c, i) => <li key={i} className="flex items-center gap-4 px-5 py-3"><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{c.title}{c.mandatory && <Badge tone="danger" className="ml-2">Mandatory</Badge>}</div></div><div className="flex w-56 items-center gap-2"><Progress value={(c.done / c.total) * 100} tone="success" /><span className="text-xs tnum text-muted">{c.done}/{c.total}</span></div></li>)}
          {byCourse.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted">No enrolments yet</li>}</ul>
      </Card>
    </div>
  )
}

export function CourseLibrary() {
  const { employeeId } = useMe()
  const nav = useNavigate()
  const courses = useQuery({ queryKey: ['learning', 'library'], queryFn: () => unwrap<any[]>(db.from('courses').select('*, course_categories(name)').eq('status', 'published').order('title')) })
  const mine = useQuery({ queryKey: ['learning', 'mine-ids', employeeId], queryFn: () => unwrap<any[]>(db.from('course_enrolments').select('course_id, status, progress').eq('employee_id', employeeId)) })
  const [cat, setCat] = useState('')
  const enrol = useAction((id: string) => rpc<string>('enrol_in_course', { p_course: id }), { success: 'Enrolled', invalidate: [['learning']], onSuccess: () => undefined })
  const by = new Map((mine.data ?? []).map((m) => [m.course_id, m]))
  const cats = [...new Set((courses.data ?? []).map((c) => c.course_categories?.name).filter(Boolean))]
  return (
    <div>
      <PageHeader title="Course library" description="Browse and enrol in published courses." actions={<Select value={cat} onChange={(e) => setCat(e.target.value)} className="w-auto"><option value="">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}</Select>} />
      <QueryView q={courses} empty={{ when: (d) => d.length === 0, title: 'No published courses yet' }}>
        {(d) => (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {d.filter((c) => !cat || c.course_categories?.name === cat).map((c) => { const e = by.get(c.id); return (
              <Card key={c.id} className="flex flex-col overflow-hidden">
                <div className="flex h-24 items-end bg-gradient-to-br from-ink to-ink-soft p-4"><GraduationCap className="h-7 w-7 text-white/80" /></div>
                <div className="flex flex-1 flex-col p-4">
                  <div className="flex flex-wrap items-center gap-1.5"><Badge>{c.course_categories?.name ?? 'General'}</Badge><Badge tone="info">{titleCase(c.level)}</Badge>{c.is_mandatory && <Badge tone="danger">Mandatory</Badge>}</div>
                  <h3 className="mt-2 font-semibold">{c.title}</h3>
                  <p className="mt-1 line-clamp-3 flex-1 text-sm text-muted">{c.summary}</p>
                  <p className="mt-3 text-xs text-subtle"><Clock className="mr-1 inline h-3 w-3" />{minutes(c.duration_minutes)}{c.instructor_name && ` · ${c.instructor_name}`}</p>
                  {e ? <div className="mt-3"><div className="mb-1 flex justify-between text-xs"><StatusBadge status={e.status} /><span className="tnum">{e.progress}%</span></div><Button size="sm" className="w-full" onClick={() => nav(`/learning/course/${c.id}`)}><Play /> {e.progress ? 'Continue' : 'Start'}</Button></div>
                    : <Button size="sm" variant="secondary" className="mt-3" loading={enrol.isPending && enrol.variables === c.id} onClick={() => enrol.mutate(c.id, { onSuccess: () => nav(`/learning/course/${c.id}`) })}>Enrol</Button>}
                </div>
              </Card>
            ) })}
          </div>
        )}
      </QueryView>
    </div>
  )
}

export function MyLearning() {
  const { employeeId } = useMe()
  const nav = useNavigate()
  const reg = useRegister((q) => q.eq('employee_id', employeeId).order('due_date', { nullsFirst: false }), `mine-${employeeId}`)
  const rows = reg.data ?? []
  return (
    <div className="space-y-5">
      <PageHeader title="My learning" actions={<Link to="/learning/library"><Button variant="secondary"><BookOpen /> Browse courses</Button></Link>} />
      <StatStrip items={[{ label: 'Enrolled', value: rows.length }, { label: 'In progress', value: rows.filter((r) => r.status === 'in_progress').length, tone: 'primary' },
        { label: 'Completed', value: rows.filter((r) => r.status === 'completed').length, tone: 'success' }, { label: 'Due this week', value: rows.filter((r) => r.status !== 'completed' && r.due_date && r.due_date <= isoDate(new Date(Date.now() + 7 * 864e5))).length, tone: 'warning' }]} />
      <QueryView q={reg} empty={{ when: (d) => d.length === 0, title: 'No courses yet', description: 'Courses assigned to you, or that you enrol in, appear here.', action: <Link to="/learning/library"><Button>Browse courses</Button></Link> }}>
        {(d) => (
          <div className="space-y-2">{d.map((r) => (
            <Card key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2 font-medium">{r.course_title}{r.is_mandatory && <Badge tone="danger">Mandatory</Badge>}{r.source === 'assigned' && <Badge>Assigned</Badge>}</div>
                <div className="mt-1 text-xs text-muted">{r.due_date ? <span className={r.due_date < isoDate() && r.status !== 'completed' ? 'text-danger' : ''}>Due {fmtDate(r.due_date)}</span> : 'No due date'}{r.certificate_number && ` · Certificate ${r.certificate_number}`}</div></div>
              <div className="flex w-full items-center gap-3 sm:w-72"><Progress value={r.progress} tone={r.status === 'completed' ? 'success' : 'primary'} /><span className="w-10 text-right text-xs tnum">{r.progress}%</span>
                <Button size="sm" variant={r.status === 'completed' ? 'secondary' : 'primary'} onClick={() => nav(`/learning/course/${r.course_id}`)}>{r.status === 'completed' ? 'Review' : 'Continue'}</Button></div>
            </Card>
          ))}</div>
        )}
      </QueryView>
    </div>
  )
}

export function CoursePlayer() {
  const { id = '' } = useParams()
  const { employeeId } = useMe()
  const course = useQuery({ queryKey: ['learning', 'course', id], queryFn: () => unwrap<any>(db.from('courses').select('*, course_modules(id, title, sort_order, course_lessons(id, title, lesson_type, content, resource_url, duration_minutes, sort_order)), assessments(id, title, kind, passing_score, max_attempts, time_limit_minutes, is_active, assessment_questions(id))').eq('id', id).single()) })
  const enr = useQuery({ queryKey: ['learning', 'enrolment', id, employeeId], queryFn: () => unwrap<any>(db.from('course_enrolments').select('*, lesson_progress(lesson_id), assessment_results(assessment_id, score, passed, attempt), certificates(certificate_number, issued_at), employees(first_name, last_name)').eq('course_id', id).eq('employee_id', employeeId).maybeSingle()) })
  const [lesson, setLesson] = useState<any | null>(null)
  const [quiz, setQuiz] = useState<any | null>(null)
  const done = useAction((l: string) => rpc<number>('complete_lesson', { p_lesson: l }), { invalidate: [['learning']] })
  const enrol = useAction(() => rpc('enrol_in_course', { p_course: id }), { success: 'Enrolled', invalidate: [['learning']] })
  const completed = new Set((enr.data?.lesson_progress ?? []).map((l: any) => l.lesson_id))
  const openRes = async (l: any) => { try { window.open(l.resource_url?.startsWith('http') ? l.resource_url : await signedUrl('learning-content', l.resource_url), '_blank', 'noopener') } catch (e) { toast.error(errorMessage(e)) } }
  return (
    <QueryView q={course}>
      {(c) => {
        const mods = [...(c.course_modules ?? [])].sort((a, b) => a.sort_order - b.sort_order)
        const cert = enr.data?.certificates?.[0] ?? enr.data?.certificates
        const quizzes = (c.assessments ?? []).filter((a: any) => a.is_active && (a.assessment_questions ?? []).length > 0)
        return (
          <div className="space-y-5">
            <PageHeader title={c.title} description={c.summary} crumbs={[{ label: 'Learning', to: '/learning/library' }, { label: 'Course' }]}
              actions={!enr.data ? <Button loading={enrol.isPending} onClick={() => enrol.mutate()}>Enrol</Button> : cert?.certificate_number && <Button variant="secondary" onClick={() => downloadCertificate(c.title, cert.certificate_number, cert.issued_at, [enr.data.employees?.first_name, enr.data.employees?.last_name].filter(Boolean).join(' ') || undefined)}><Award /> Certificate</Button>} />
            {enr.data && <Card className="flex items-center gap-4 p-4"><Progress value={enr.data.progress} tone={enr.data.status === 'completed' ? 'success' : 'primary'} /><span className="text-sm tnum">{enr.data.progress}%</span><StatusBadge status={enr.data.status} /></Card>}
            <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
              <div className="space-y-4">
                {mods.map((m, mi) => (
                  <Card key={m.id}><CardHeader title={`${mi + 1}. ${m.title}`} />
                    <ul className="divide-y divide-line">{[...(m.course_lessons ?? [])].sort((a: any, b: any) => a.sort_order - b.sort_order).map((l: any) => (
                      <li key={l.id}><button disabled={!enr.data} onClick={() => setLesson(l)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-raised disabled:cursor-not-allowed">
                        {completed.has(l.id) ? <CheckCircle2 className="h-5 w-5 text-success" /> : <Circle className="h-5 w-5 text-line" />}
                        <span className="flex-1 text-sm">{l.title}</span><span className="flex items-center gap-1 text-xs text-muted">{l.lesson_type === 'video' ? <Video className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}{l.duration_minutes} min</span>
                      </button></li>
                    ))}</ul>
                  </Card>
                ))}
                {quizzes.map((a: any) => {
                  const res = (enr.data?.assessment_results ?? []).filter((r: any) => r.assessment_id === a.id)
                  const best = res.reduce((m: number, r: any) => Math.max(m, r.score), 0)
                  return (
                    <Card key={a.id} className="flex items-center justify-between gap-3 p-4">
                      <div><div className="flex items-center gap-2 font-medium"><ListChecks className="h-4 w-4 text-primary" />{a.title}</div><div className="text-xs text-muted">{a.assessment_questions.length} question{a.assessment_questions.length === 1 ? '' : 's'} · pass mark {a.passing_score}%{a.time_limit_minutes ? ` · ${a.time_limit_minutes} min` : ''} · {res.length}/{a.max_attempts} attempts{res.length > 0 && ` · best ${best}%`}</div></div>
                      {res.some((r: any) => r.passed) ? <Badge tone="success">Passed</Badge> : <Button size="sm" disabled={!enr.data || res.length >= a.max_attempts} onClick={() => setQuiz(a)}>{res.length ? 'Retry' : 'Start'}</Button>}
                    </Card>
                  )
                })}
              </div>
              <Card className="h-fit p-5 text-sm">
                <h3 className="font-semibold">About this course</h3>
                {c.description && <p className="mt-2 text-muted">{c.description}</p>}
                <dl className="mt-4 space-y-2"><div className="flex justify-between"><dt className="text-muted">Duration</dt><dd>{minutes(c.duration_minutes)}</dd></div><div className="flex justify-between"><dt className="text-muted">Level</dt><dd>{titleCase(c.level)}</dd></div>
                  {quizzes.length > 0 && <div className="flex justify-between"><dt className="text-muted">To complete</dt><dd>Lessons + pass {quizzes.length === 1 ? 'the quiz' : `${quizzes.length} quizzes`}</dd></div>}{c.instructor_name && <div className="flex justify-between"><dt className="text-muted">Instructor</dt><dd>{c.instructor_name}</dd></div>}</dl>
                {c.instructor_bio && <p className="mt-3 text-xs text-muted">{c.instructor_bio}</p>}
              </Card>
            </div>
            <Dialog open={!!lesson} onOpenChange={(o) => !o && setLesson(null)} title={lesson?.title ?? ''} size="lg"
              footer={lesson && !completed.has(lesson.id) && <Button loading={done.isPending} onClick={() => done.mutate(lesson.id, { onSuccess: () => setLesson(null) })}><CheckCircle2 /> Mark complete</Button>}>
              {lesson?.content && <div className="whitespace-pre-line text-sm leading-relaxed">{lesson.content}</div>}
              {lesson?.resource_url && (lesson.lesson_type === 'video' && /youtube|vimeo|\.mp4/.test(lesson.resource_url)
                ? <div className="mt-4 aspect-video overflow-hidden rounded-lg bg-black">{/\.mp4/.test(lesson.resource_url) ? <video src={lesson.resource_url} controls className="h-full w-full" /> : <iframe src={lesson.resource_url.replace('watch?v=', 'embed/')} title={lesson.title} className="h-full w-full" allowFullScreen />}</div>
                : <Button variant="secondary" className="mt-4" onClick={() => openRes(lesson)}><ExternalLink /> Open {titleCase(lesson.lesson_type)}</Button>)}
            </Dialog>
            {quiz && <TakeAssessment assessment={quiz} onClose={() => setQuiz(null)} />}
          </div>
        )
      }}
    </QueryView>
  )
}

function TakeAssessment({ assessment, onClose }: { assessment: any; onClose: () => void }) {
  const qs = useQuery({ queryKey: ['learning', 'quiz', assessment.id], queryFn: () => unwrap<any[]>(db.from('assessment_questions').select('id, question, points, sort_order, assessment_options(id, option_text, sort_order)').eq('assessment_id', assessment.id).order('sort_order')) })
  const [ans, setAns] = useState<Record<string, string>>({})
  const [result, setResult] = useState<any | null>(null)
  const submit = useAction(() => rpc('submit_assessment', { p_assessment: assessment.id, p_answers: ans }), { invalidate: [['learning']], onSuccess: setResult })
  const limit = assessment.time_limit_minutes ? assessment.time_limit_minutes * 60 : null
  const [left, setLeft] = useState(limit)
  useEffect(() => {
    if (!limit || result || !qs.data) return
    const t = setInterval(() => setLeft((s) => (s == null ? s : Math.max(0, s - 1))), 1000)
    return () => clearInterval(t)
  }, [limit, result, qs.data])
  useEffect(() => { if (left === 0 && !result && !submit.isPending) { toast.info('Time is up — your answers were submitted'); submit.mutate() } }, [left])
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={assessment.title} description={`Pass mark ${assessment.passing_score}%.${left != null && !result ? ` Time left ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : ''}`} size="lg"
      footer={!result ? <Button loading={submit.isPending} disabled={Object.keys(ans).length < (qs.data?.length ?? 0)} onClick={() => submit.mutate()}><Send /> Submit answers</Button> : <Button onClick={onClose}>Close</Button>}>
      {result ? (
        <div className="py-6 text-center"><div className={cn('figure text-5xl', result.passed ? 'text-success' : 'text-danger')}>{result.score}%</div><p className="mt-2 font-medium">{result.passed ? 'Passed' : 'Not passed'}</p><p className="text-sm text-muted">{result.passed ? 'Well done.' : `${result.attempts_left} attempt${result.attempts_left === 1 ? '' : 's'} left.`}</p></div>
      ) : (
        <ol className="space-y-5">{(qs.data ?? []).map((q, i) => (
          <li key={q.id}><p className="mb-2 text-sm font-medium">{i + 1}. {q.question}</p>
            <div className="space-y-1.5">{[...(q.assessment_options ?? [])].sort((a: any, b: any) => a.sort_order - b.sort_order).map((o: any) => (
              <label key={o.id} className={cn('flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm', ans[q.id] === o.id ? 'border-primary bg-primary-soft' : 'border-line hover:bg-raised')}>
                <input type="radio" name={q.id} checked={ans[q.id] === o.id} onChange={() => setAns({ ...ans, [q.id]: o.id })} />{o.option_text}</label>
            ))}</div></li>
        ))}</ol>
      )}
    </Dialog>
  )
}

export async function downloadCertificate(course: string, number: string, issued: string, name?: string) {
  const { jsPDF } = await import('jspdf')
  const org = await unwrap<any>(db.from('organisations').select('name, legal_name').single())
  const me = name ?? (await db.auth.getUser()).data.user?.user_metadata?.full_name ?? ''
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight()
  doc.setDrawColor(63, 60, 187); doc.setLineWidth(3); doc.rect(28, 28, W - 56, H - 56)
  doc.setLineWidth(0.6); doc.rect(38, 38, W - 76, H - 76)
  doc.setTextColor(15, 27, 61); doc.setFontSize(30); doc.text('Certificate of completion', W / 2, 150, { align: 'center' })
  doc.setFontSize(13); doc.setTextColor(100); doc.text('This certifies that', W / 2, 200, { align: 'center' })
  doc.setFontSize(26); doc.setTextColor(15, 27, 61); doc.text(me || 'Employee', W / 2, 245, { align: 'center' })
  doc.setFontSize(13); doc.setTextColor(100); doc.text('has successfully completed', W / 2, 285, { align: 'center' })
  doc.setFontSize(20); doc.setTextColor(63, 60, 187); doc.text(course, W / 2, 325, { align: 'center' })
  doc.setFontSize(11); doc.setTextColor(110); doc.text(`${org.legal_name ?? org.name} · Issued ${fmtDate(issued)} · ${number}`, W / 2, H - 90, { align: 'center' })
  doc.save(`${number}.pdf`)
}

export const CourseCategoriesPage = () => <CrudPage cfg={{ title: 'Course categories', table: 'course_categories', permission: 'learning.manage', orderBy: { column: 'name' }, remove: 'delete',
  columns: [{ key: 'name', header: 'Category' }, { key: 'description', header: 'Description' }], fields: [{ name: 'name', label: 'Name', type: 'text', required: true }, { name: 'description', label: 'Description', type: 'textarea' }] }} />

export function ProgramsPage() {
  const [builder, setBuilder] = useState<any | null>(null)
  return (
    <>
      <CrudPage cfg={{
        title: 'Training programs', description: 'Create courses, then add modules and lessons (text, video links, PDFs or presentations).',
        table: 'courses', select: '*, course_categories(name)', permission: 'learning.manage', orderBy: { column: 'title' }, remove: { column: 'status', value: 'archived' },
        columns: [{ key: 'title', header: 'Course', cell: (r) => <div><div className="font-medium">{r.title}</div><div className="text-xs text-muted">{r.course_categories?.name}</div></div> },
          { key: 'level', header: 'Level', value: (r) => titleCase(r.level) }, { key: 'duration_minutes', header: 'Duration', value: (r) => minutes(r.duration_minutes) },
          { key: 'is_mandatory', header: 'Mandatory', value: (r) => (r.is_mandatory ? 'Yes' : '') }, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> }],
        rowActions: (r) => <Button size="sm" variant="ghost" onClick={() => setBuilder(r)}>Content</Button>,
        fields: [{ name: 'title', label: 'Title', type: 'text', required: true, wide: true }, { name: 'category_id', label: 'Category', type: 'lookup', lookup: { table: 'course_categories' } },
          { name: 'level', label: 'Level', type: 'select', required: true, default: 'beginner', options: ['beginner', 'intermediate', 'advanced'].map((v) => ({ value: v, label: titleCase(v) })) },
          { name: 'summary', label: 'Summary', type: 'textarea' }, { name: 'description', label: 'Description', type: 'textarea' },
          { name: 'instructor_name', label: 'Instructor', type: 'text' }, { name: 'duration_minutes', label: 'Duration (minutes)', type: 'number', min: 1, default: 60, required: true },
          { name: 'instructor_bio', label: 'Instructor bio', type: 'textarea' },
          { name: 'is_mandatory', label: 'Mandatory', type: 'switch' }, { name: 'certificate_enabled', label: 'Issue certificate on completion', type: 'switch', default: true },
          { name: 'status', label: 'Status', type: 'select', required: true, default: 'draft', options: ['draft', 'published', 'archived'].map((v) => ({ value: v, label: titleCase(v) })) }],
      }} />
      {builder && <CourseBuilder course={builder} onClose={() => setBuilder(null)} />}
    </>
  )
}

function CourseBuilder({ course, onClose }: { course: any; onClose: () => void }) {
  const mods = useQuery({ queryKey: ['learning', 'builder', course.id], queryFn: () => unwrap<any[]>(db.from('course_modules').select('*, course_lessons(*)').eq('course_id', course.id).order('sort_order')) })
  const [mt, setMt] = useState('')
  const addMod = useAction(() => unwrap(db.from('course_modules').insert({ course_id: course.id, title: mt, sort_order: (mods.data?.length ?? 0) + 1 }).select('id')), { invalidate: [['learning', 'builder', course.id]], onSuccess: () => setMt('') })
  const confirm = useConfirm()
  const delMod = useAction((id: string) => unwrap(db.from('course_modules').delete().eq('id', id).select('id')), { invalidate: [['learning', 'builder', course.id]] })
  const [lessonFor, setLessonFor] = useState<string | null>(null)
  const [l, setL] = useState({ title: '', lesson_type: 'text', content: '', resource_url: '', duration_minutes: 10 })
  const addLesson = useAction(() => unwrap(db.from('course_lessons').insert({ ...l, module_id: lessonFor, sort_order: Math.max(0, ...((mods.data ?? []).find((m) => m.id === lessonFor)?.course_lessons ?? []).map((x: any) => x.sort_order ?? 0)) + 1, resource_url: l.resource_url || null, content: l.content || null }).select('id')), { success: 'Lesson added', invalidate: [['learning', 'builder', course.id]], onSuccess: () => { setLessonFor(null); setL({ title: '', lesson_type: 'text', content: '', resource_url: '', duration_minutes: 10 }) } })
  const delLesson = useAction((id: string) => unwrap(db.from('course_lessons').delete().eq('id', id).select('id')), { invalidate: [['learning', 'builder', course.id]] })
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={course.title} description="Modules and lessons">
      <div className="space-y-3">{(mods.data ?? []).map((m) => (
        <Card key={m.id}><CardHeader title={m.title} actions={<><Button size="sm" variant="secondary" onClick={() => setLessonFor(m.id)}><Plus /> Lesson</Button><Button size="icon-sm" variant="ghost" aria-label="Delete module" onClick={async () => { if ((await confirm({ title: `Delete module “${m.title}”?`, description: 'All lessons in this module are deleted too.', confirmLabel: 'Delete module', danger: true })).ok) delMod.mutate(m.id) }}><Trash2 /></Button></>} />
          <ul className="divide-y divide-line">{[...(m.course_lessons ?? [])].sort((a: any, b: any) => a.sort_order - b.sort_order).map((x: any) => <li key={x.id} className="flex items-center justify-between px-5 py-2 text-sm"><span>{x.title} <span className="text-xs text-muted">· {titleCase(x.lesson_type)} · {x.duration_minutes} min</span></span><Button size="icon-sm" variant="ghost" aria-label="Delete lesson" onClick={async () => { if ((await confirm({ title: `Delete lesson “${x.title}”?`, confirmLabel: 'Delete lesson', danger: true })).ok) delLesson.mutate(x.id) }}><Trash2 /></Button></li>)}
            {(m.course_lessons ?? []).length === 0 && <li className="px-5 py-3 text-sm text-muted">No lessons</li>}</ul>
        </Card>
      ))}</div>
      <div className="mt-4 flex gap-2"><Input placeholder="New module title" value={mt} onChange={(e) => setMt(e.target.value)} /><Button disabled={!mt} onClick={() => addMod.mutate()}><Plus /> Module</Button></div>
      <Dialog open={!!lessonFor} onOpenChange={(o) => !o && setLessonFor(null)} title="New lesson" footer={<Button loading={addLesson.isPending} disabled={!l.title} onClick={() => addLesson.mutate()}>Add lesson</Button>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" required className="sm:col-span-2"><Input value={l.title} onChange={(e) => setL({ ...l, title: e.target.value })} /></Field>
          <Field label="Type"><Select value={l.lesson_type} onChange={(e) => setL({ ...l, lesson_type: e.target.value })}>{['text', 'video', 'pdf', 'presentation', 'link'].map((v) => <option key={v} value={v}>{titleCase(v)}</option>)}</Select></Field>
          <Field label="Minutes"><Input type="number" value={l.duration_minutes} onChange={(e) => setL({ ...l, duration_minutes: Number(e.target.value) })} /></Field>
          <Field label="Resource URL or storage path" className="sm:col-span-2" hint="YouTube/Vimeo/MP4 links play inline; storage paths in the learning-content bucket open via signed links"><Input value={l.resource_url} onChange={(e) => setL({ ...l, resource_url: e.target.value })} /></Field>
          <Field label="Lesson text" className="sm:col-span-2"><Textarea rows={6} value={l.content} onChange={(e) => setL({ ...l, content: e.target.value })} /></Field>
        </div>
      </Dialog>
    </Drawer>
  )
}

export function EnrolmentsPage({ progressView }: { progressView?: boolean }) {
  const { can } = useAuth()
  const [status, setStatus] = useState('')
  const reg = useRegister(status ? (q) => q.eq('status', status) : undefined, `enrol-${status}`)
  const [open, setOpen] = useState(false)
  const courses = useLookup<any>('courses', 'id, title', 'title', (q) => q.eq('status', 'published'))
  const [course, setCourse] = useState(''); const [emps, setEmps] = useState<string[]>([]); const [pick, setPick] = useState<string | null>(null); const [due, setDue] = useState('')
  const enrol = useAction(() => unwrap(db.from('course_enrolments').upsert(emps.map((e) => ({ course_id: course, employee_id: e, source: 'assigned', due_date: due || null })), { onConflict: 'course_id,employee_id' }).select('id')), { success: 'Employees enrolled', invalidate: [['learning']], onSuccess: () => { setOpen(false); setEmps([]) } })
  return (
    <div>
      <PageHeader title={progressView ? 'Learning progress' : 'Employee enrolment'} description={progressView ? 'Progress and completion for every enrolment you can see.' : 'Enrol individuals directly. For whole departments or roles, use Learning Assignments.'}
        actions={!progressView && can('learning.manage') && <Button onClick={() => setOpen(true)}><Users /> Enrol employees</Button>} />
      <DataTable rows={reg.data} loading={reg.isLoading} error={reg.error} exportName={progressView ? 'Learning progress' : 'Enrolments'} columns={[
        { key: 'employee_name', header: 'Employee', cell: (r) => <EmployeeCell name={r.employee_name} sub={r.department_name} /> }, { key: 'course_title', header: 'Course' },
        { key: 'source', header: 'Source', value: (r) => titleCase(r.source), hideOnMobile: true },
        { key: 'progress', header: 'Progress', value: (r) => r.progress, cell: (r) => <div className="flex w-36 items-center gap-2"><Progress value={r.progress} tone={r.status === 'completed' ? 'success' : 'primary'} /><span className="text-xs tnum">{r.progress}%</span></div> },
        { key: 'due_date', header: 'Due', cell: (r) => <span className={r.due_date && r.due_date < isoDate() && r.status !== 'completed' ? 'text-danger' : ''}>{fmtDate(r.due_date)}</span> },
        { key: 'completed_at', header: 'Completed', cell: (r) => fmtDate(r.completed_at), hideOnMobile: true }, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
      ]} toolbar={<Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Status"><option value="">All</option>{['enrolled', 'in_progress', 'completed', 'failed', 'withdrawn'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>} />
      <Dialog open={open} onOpenChange={setOpen} title="Enrol employees" footer={<Button loading={enrol.isPending} disabled={!course || !emps.length} onClick={() => enrol.mutate()}>Enrol {emps.length || ''}</Button>}>
        <div className="space-y-4">
          <Field label="Course" required><Select value={course} onChange={(e) => setCourse(e.target.value)}><option value="">Select…</option>{(courses.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</Select></Field>
          <Field label="Add employee"><EmployeePicker value={pick} onChange={(id) => { if (id && !emps.includes(id)) setEmps([...emps, id]); setPick(null) }} /></Field>
          <p className="text-sm text-muted">{emps.length} selected</p>
          <Field label="Due date"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
      </Dialog>
    </div>
  )
}

export function AssignmentsPage() {
  const apply = useAction((id: string) => rpc<number>('apply_course_assignment', { p_assignment: id }), { success: (n) => `${n} employees enrolled and notified`, invalidate: [['learning']] })
  return <CrudPage cfg={{
    title: 'Learning assignments', description: 'Assign a course to everyone, a department, a designation or one employee. “Apply” creates enrolments and notifies people.',
    table: 'course_assignments', select: '*, courses(title), departments(name), designations(name), employees(first_name, last_name)', permission: 'learning.manage', orderBy: { column: 'created_at', ascending: false }, remove: 'delete',
    columns: [{ key: 'course', header: 'Course', value: (r) => r.courses?.title }, { key: 'target', header: 'Assigned to', value: (r) => r.target_type === 'all' ? 'Everyone' : r.target_type === 'department' ? r.departments?.name : r.target_type === 'designation' ? r.designations?.name : `${r.employees?.first_name} ${r.employees?.last_name}` },
      { key: 'due_date', header: 'Due', cell: (r) => fmtDate(r.due_date) }, { key: 'created_at', header: 'Created', cell: (r) => fmtDate(r.created_at) }],
    rowActions: (r) => <Button size="sm" variant="secondary" loading={apply.isPending && apply.variables === r.id} onClick={() => apply.mutate(r.id)}>Apply</Button>,
    fields: [{ name: 'course_id', label: 'Course', type: 'lookup', lookup: { table: 'courses', label: 'title', order: 'title', filter: (q) => q.eq('status', 'published') }, required: true },
      { name: 'target_type', label: 'Assign to', type: 'select', required: true, default: 'all', options: [{ value: 'all', label: 'Everyone' }, { value: 'department', label: 'Department' }, { value: 'designation', label: 'Designation' }, { value: 'employee', label: 'One employee' }] },
      { name: 'department_id', label: 'Department', type: 'lookup', lookup: { table: 'departments' }, showIf: (v) => v.target_type === 'department' },
      { name: 'designation_id', label: 'Designation', type: 'lookup', lookup: { table: 'designations' }, showIf: (v) => v.target_type === 'designation' },
      { name: 'employee_id', label: 'Employee', type: 'employee', showIf: (v) => v.target_type === 'employee' }, { name: 'due_date', label: 'Due date', type: 'date' }],
  }} />
}

export function TrainingCalendarPage() {
  const { can } = useAuth()
  const [month, setMonth] = useState(startOfMonth(new Date()))
  const q = useQuery({ queryKey: ['crud', 'training_sessions'], queryFn: () => unwrap<any[]>(db.from('training_sessions').select('*, courses(title)').order('starts_at')) })
  return (
    <div className="space-y-5">
      <PageHeader title="Training calendar" description="Instructor-led sessions." actions={<MonthNav month={month} onChange={setMonth} />} />
      <MonthCalendar month={month} renderDay={(d) => (q.data ?? []).filter((s) => isWithinInterval(d, { start: startOfDay(s.starts_at), end: parseISO(s.ends_at) })).map((s) => <div key={s.id} title={`${s.title} · ${s.venue ?? ''}`} className="mb-0.5 truncate rounded bg-primary px-1 text-[11px] text-primary-fg">{fmtDate(s.starts_at, 'HH:mm')} {s.title}</div>)} />
      {can('learning.manage') && <CrudPage cfg={{
        title: 'Sessions', embedded: true, table: 'training_sessions', select: '*, courses(title)', permission: 'learning.manage', orderBy: { column: 'starts_at', ascending: false }, remove: 'delete',
        columns: [{ key: 'title', header: 'Session' }, { key: 'course', header: 'Course', value: (r) => r.courses?.title }, { key: 'starts_at', header: 'Starts', cell: (r) => fmtDateTime(r.starts_at) }, { key: 'venue', header: 'Venue' }, { key: 'trainer', header: 'Trainer' }, { key: 'capacity', header: 'Capacity' }],
        fields: [{ name: 'title', label: 'Title', type: 'text', required: true }, { name: 'course_id', label: 'Course', type: 'lookup', lookup: { table: 'courses', label: 'title', order: 'title' } },
          { name: 'starts_at', label: 'Starts', type: 'datetime', required: true }, { name: 'ends_at', label: 'Ends', type: 'datetime', required: true },
          { name: 'trainer', label: 'Trainer', type: 'text' }, { name: 'venue', label: 'Venue', type: 'text' }, { name: 'capacity', label: 'Capacity', type: 'number', min: 1 }],
      }} />}
    </div>
  )
}
const startOfDay = (s: string) => { const d = parseISO(s); d.setHours(0, 0, 0, 0); return d }

export function AssessmentsPage() {
  const [params] = useSearchParams()
  const kind = params.get('kind') ?? 'assessment'
  const [edit, setEdit] = useState<any | null>(null)
  return (
    <>
      <CrudPage cfg={{
        title: kind === 'quiz' ? 'Quizzes' : 'Assessments', description: 'Multiple-choice tests attached to a course. The answer key is never sent to employees; grading happens on the server.',
        table: 'assessments', select: '*, courses(title), assessment_questions(id)', permission: 'learning.manage', orgScoped: false, filter: (q) => q.eq('kind', kind), queryKey: ['crud', 'assessments', kind], remove: { column: 'is_active', value: false },
        defaults: () => ({ kind }),
        columns: [{ key: 'title', header: 'Title' }, { key: 'course', header: 'Course', value: (r) => r.courses?.title }, { key: 'questions', header: 'Questions', value: (r) => r.assessment_questions?.length ?? 0 },
          { key: 'passing_score', header: 'Pass mark', value: (r) => `${r.passing_score}%` }, { key: 'max_attempts', header: 'Attempts' }, { key: 'is_active', header: 'Active', value: (r) => (r.is_active ? 'Yes' : 'No') }],
        rowActions: (r) => <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Questions</Button>,
        fields: [{ name: 'title', label: 'Title', type: 'text', required: true }, { name: 'course_id', label: 'Course', type: 'lookup', lookup: { table: 'courses', label: 'title', order: 'title' }, required: true },
          { name: 'kind', label: 'Kind', type: 'select', required: true, options: [{ value: 'quiz', label: 'Quiz' }, { value: 'assessment', label: 'Assessment' }] },
          { name: 'passing_score', label: 'Pass mark (%)', type: 'number', min: 0, max: 100, default: 70, required: true }, { name: 'max_attempts', label: 'Max attempts', type: 'number', min: 1, default: 3, required: true },
          { name: 'time_limit_minutes', label: 'Time limit (minutes)', type: 'number', min: 1 }, { name: 'is_active', label: 'Active', type: 'switch', default: true }],
      }} />
      {edit && <QuestionBuilder assessment={edit} onClose={() => setEdit(null)} />}
    </>
  )
}

function QuestionBuilder({ assessment, onClose }: { assessment: any; onClose: () => void }) {
  const qs = useQuery({ queryKey: ['learning', 'qb', assessment.id], queryFn: () => unwrap<any[]>(db.from('assessment_questions').select('id, question, points, sort_order, assessment_options(id, option_text, sort_order)').eq('assessment_id', assessment.id).order('sort_order')) })
  const key = useQuery({ queryKey: ['learning', 'qb-key', assessment.id], queryFn: () => rpc<any[]>('assessment_answer_key', { p_assessment: assessment.id }) })
  const correct = new Set((key.data ?? []).filter((k) => k.is_correct).map((k) => k.option_id))
  const [q, setQ] = useState(''); const [opts, setOpts] = useState(['', '', '', '']); const [right, setRight] = useState(0)
  const add = useAction(async () => {
    const [nq] = await unwrap<any[]>(db.from('assessment_questions').insert({ assessment_id: assessment.id, question: q, sort_order: (qs.data?.length ?? 0) + 1 }).select('id'))
    await unwrap(db.from('assessment_options').insert(opts.map((o, i) => ({ question_id: nq.id, option_text: o, is_correct: i === right, sort_order: i + 1 })).filter((o) => o.option_text.trim())).select('id'))
  }, { success: 'Question added', invalidate: [['learning', 'qb', assessment.id], ['learning', 'qb-key', assessment.id]], onSuccess: () => { setQ(''); setOpts(['', '', '', '']); setRight(0) } })
  const confirm = useConfirm()
  const del = useAction((id: string) => unwrap(db.from('assessment_questions').delete().eq('id', id).select('id')), { invalidate: [['learning', 'qb', assessment.id]] })
  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={assessment.title} description="Questions and answer key">
      <ol className="space-y-3">{(qs.data ?? []).map((x, i) => (
        <Card key={x.id} className="p-4"><div className="flex items-start justify-between gap-2"><p className="text-sm font-medium">{i + 1}. {x.question}</p><Button size="icon-sm" variant="ghost" aria-label="Delete question" onClick={async () => { if ((await confirm({ title: 'Delete this question?', confirmLabel: 'Delete', danger: true })).ok) del.mutate(x.id) }}><Trash2 /></Button></div>
          <ul className="mt-2 space-y-1">{[...(x.assessment_options ?? [])].sort((a: any, b: any) => a.sort_order - b.sort_order).map((o: any) => <li key={o.id} className={cn('flex items-center gap-2 text-sm', correct.has(o.id) ? 'text-success' : 'text-muted')}>{correct.has(o.id) ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}{o.option_text}</li>)}</ul></Card>
      ))}</ol>
      <Card className="mt-5 space-y-3 p-4">
        <Field label="New question"><Input value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        {opts.map((o, i) => <div key={i} className="flex items-center gap-2"><input type="radio" name="right" checked={right === i} onChange={() => setRight(i)} aria-label={`Option ${i + 1} is correct`} /><Input placeholder={`Option ${i + 1}`} value={o} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value : x)))} /></div>)}
        <p className="text-xs text-muted">Select the radio button next to the correct answer.</p>
        <Button disabled={!q || opts.filter((o) => o.trim()).length < 2 || !opts[right]?.trim()} loading={add.isPending} onClick={() => add.mutate()}><Plus /> Add question</Button>
      </Card>
    </Drawer>
  )
}

export function CertificatesPage() {
  const reg = useRegister((q) => q.not('certificate_number', 'is', null), 'certs')
  return (
    <div>
      <PageHeader title="Certificates" description="Issued automatically when a course with certificates enabled is completed." />
      <DataTable rows={reg.data} loading={reg.isLoading} error={reg.error} exportName="Certificates" columns={[
        { key: 'certificate_number', header: 'Certificate', className: 'tnum' }, { key: 'employee_name', header: 'Employee' }, { key: 'course_title', header: 'Course' },
        { key: 'completed_at', header: 'Issued', cell: (r) => fmtDate(r.completed_at) },
        { key: '_a', header: '', sortable: false, exportable: false, className: 'text-right', cell: (r) => <Button size="sm" variant="secondary" onClick={() => downloadCertificate(r.course_title, r.certificate_number, r.completed_at, r.employee_name)}><Download /> PDF</Button> },
      ]} emptyTitle="No certificates yet" />
    </div>
  )
}
