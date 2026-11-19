import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Award, CheckCheck, Megaphone, Plus, Send, ThumbsUp, Users, BarChart2, CalendarDays, MapPin } from 'lucide-react'
import { db, rpc, unwrap } from '@/lib/api'
import { useAuth, useMe } from '@/app/auth'
import { useAction } from '@/hooks/data'
import { DataTable } from '@/components/common/DataTable'
import { PageHeader, QueryView, EmptyState, StatStrip } from '@/components/common/page'
import { EmployeeCell, EmployeePicker } from '@/components/common/pickers'
import { StatusBadge } from '@/components/common/status'
import { CrudPage, CrudDialog, type CrudConfig } from '@/components/crud/CrudPage'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Avatar, Badge, Card, CardHeader, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { ago, cn, fmtDate, fmtDateTime, isoDate, titleCase } from '@/lib/utils'
import { useNotifications } from '@/components/layout/Topbar'

type Category = 'announcement' | 'news' | 'communication' | 'policy'
const CAT_META: Record<Category, { title: string; desc: string }> = {
  announcement: { title: 'Announcements', desc: 'Company-wide or department-specific notices, with read tracking.' },
  news: { title: 'Company news', desc: 'Milestones, product launches and stories from across the company.' },
  communication: { title: 'Internal communication', desc: 'Operational messages for specific departments or locations.' },
  policy: { title: 'Company policies', desc: 'Published policies. Employees acknowledge them; HR tracks who has.' },
}

const annCfg = (category: Category): CrudConfig => ({
  title: CAT_META[category].title, table: 'announcements', permission: 'engagement.manage', embedded: true, queryKey: ['crud', 'announcements', category],
  filter: (q) => q.eq('category', category), orderBy: { column: 'publish_at', ascending: false }, remove: { column: 'status', value: 'archived' },
  defaults: () => ({ category, status: 'draft', audience: 'all', priority: 'normal', requires_acknowledgement: category === 'policy', publish_at: new Date().toISOString().slice(0, 16) }),
  columns: [], fields: [
    { name: 'title', label: 'Title', type: 'text', required: true, wide: true }, { name: 'body', label: 'Message', type: 'textarea', required: true },
    { name: 'category', label: 'Category', type: 'select', required: true, options: ['announcement', 'news', 'communication', 'policy', 'notice'].map((v) => ({ value: v, label: titleCase(v) })) },
    { name: 'priority', label: 'Priority', type: 'select', required: true, options: ['normal', 'important', 'urgent'].map((v) => ({ value: v, label: titleCase(v) })) },
    { name: 'audience', label: 'Audience', type: 'select', required: true, options: [{ value: 'all', label: 'Everyone' }, { value: 'department', label: 'A department' }, { value: 'location', label: 'A location' }] },
    { name: 'department_id', label: 'Department', type: 'lookup', lookup: { table: 'departments' }, showIf: (v) => v.audience === 'department' },
    { name: 'location_id', label: 'Location', type: 'lookup', lookup: { table: 'locations' }, showIf: (v) => v.audience === 'location' },
    { name: 'publish_at', label: 'Publish at', type: 'datetime', required: true, hint: 'Future times schedule the post' }, { name: 'expires_at', label: 'Expires at', type: 'datetime' },
    { name: 'requires_acknowledgement', label: 'Require acknowledgement', type: 'switch' }, { name: 'policy_version', label: 'Policy version', type: 'text', showIf: (v) => v.category === 'policy' },
    { name: 'status', label: 'Status', type: 'select', required: true, options: [{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }, { value: 'archived', label: 'Archived' }] },
  ],
})

function Feed({ category }: { category: Category }) {
  const { employeeId } = useMe()
  const q = useQuery({ queryKey: ['engagement', 'feed', category], queryFn: () => unwrap<any[]>(db.from('my_announcements').select('*').eq('category', category).order('publish_at', { ascending: false })) })
  const mark = useAction(({ id, ack }: { id: string; ack: boolean }) => rpc('mark_announcement', { p_announcement: id, p_acknowledge: ack }), { invalidate: [['engagement']] })
  return (
    <QueryView q={q} empty={{ when: (d) => d.length === 0, title: 'Nothing published yet' }}>
      {(items) => (
        <div className="space-y-3">
          {items.map((a) => (
            <SeenCard key={a.id} unread={!!employeeId && !a.read_at} onSeen={() => mark.mutate({ id: a.id, ack: false })} className={cn('p-5', !a.read_at && 'border-l-4 border-l-primary')}>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">{a.title}</h3>
                {a.priority !== 'normal' && <Badge tone={a.priority === 'urgent' ? 'danger' : 'warning'}>{titleCase(a.priority)}</Badge>}
                {!a.read_at && <Badge tone="primary">New</Badge>}
                {a.policy_version && <Badge>Version {a.policy_version}</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted">{fmtDateTime(a.publish_at)}{a.audience !== 'all' && ` · ${titleCase(a.audience)} audience`}</p>
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed">{a.body}</p>
              {a.requires_acknowledgement && !!employeeId && (
                <div className="mt-4">{a.acknowledged_at
                  ? <span className="inline-flex items-center gap-1.5 text-sm text-success"><CheckCheck className="h-4 w-4" />Acknowledged {fmtDate(a.acknowledged_at)}</span>
                  : <Button size="sm" onClick={() => mark.mutate({ id: a.id, ack: true })}><CheckCheck /> I have read and acknowledge</Button>}</div>
              )}
            </SeenCard>
          ))}
        </div>
      )}
    </QueryView>
  )
}

/** Marks a post read once at least half of it has been on screen for a second. */
function SeenCard({ unread, onSeen, className, children }: { unread: boolean; onSeen: () => void; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const fired = useRef(false)
  useEffect(() => {
    if (!unread || !ref.current || typeof IntersectionObserver === 'undefined') return
    let t: ReturnType<typeof setTimeout> | undefined
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !fired.current) t = setTimeout(() => { fired.current = true; onSeen(); io.disconnect() }, 1000)
      else if (t) clearTimeout(t)
    }, { threshold: 0.5 })
    io.observe(ref.current)
    return () => { io.disconnect(); if (t) clearTimeout(t) }
  }, [unread]) // eslint-disable-line
  return <div ref={ref}><Card className={className}>{children}</Card></div>
}

function Manage({ category }: { category: Category }) {
  const q = useQuery({ queryKey: ['crud', 'announcements', category], queryFn: () => unwrap<any[]>(db.from('announcements').select('*, announcement_recipients(read_at, acknowledged_at)').eq('category', category).order('publish_at', { ascending: false })) })
  const people = useQuery({ queryKey: ['engagement', 'audience'], queryFn: () => unwrap<any[]>(db.from('employee_directory').select('id, department_id, location_id').not('status', 'in', '(exited,inactive)')) })
  const audienceSize = (r: any) => { const p = people.data; if (!p) return '—'; return r.audience === 'department' ? p.filter((e) => e.department_id === r.department_id).length : r.audience === 'location' ? p.filter((e) => e.location_id === r.location_id).length : p.length }
  const [edit, setEdit] = useState<any | null | undefined>(undefined)
  const publish = useAction((id: string) => rpc<number>('publish_announcement', { p_id: id }), { success: 'Published and audience notified', invalidate: [['crud', 'announcements'], ['engagement']] })
  const cfg = annCfg(category)
  return (
    <>
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} onRowClick={setEdit} exportName={CAT_META[category].title}
        toolbar={<Button size="sm" className="ml-auto" onClick={() => setEdit(null)}><Plus /> New post</Button>} columns={[
          { key: 'title', header: 'Title', cell: (r) => <div><div className="font-medium">{r.title}</div><div className="text-xs text-muted">{titleCase(r.audience)} · {titleCase(r.priority)}</div></div> },
          { key: 'publish_at', header: 'Publish', cell: (r) => <span className={new Date(r.publish_at) > new Date() ? 'text-info' : ''}>{fmtDateTime(r.publish_at)}{new Date(r.publish_at) > new Date() && ' (scheduled)'}</span> },
          { key: 'reads', header: 'Read', value: (r) => r.announcement_recipients?.filter((x: any) => x.read_at).length ?? 0, cell: (r) => <span className="tnum">{r.announcement_recipients?.filter((x: any) => x.read_at).length ?? 0} / {audienceSize(r)}</span> },
          { key: 'acks', header: 'Acknowledged', value: (r) => (r.requires_acknowledgement ? r.announcement_recipients?.filter((x: any) => x.acknowledged_at).length : null), cell: (r) => (r.requires_acknowledgement ? <span className="tnum">{r.announcement_recipients?.filter((x: any) => x.acknowledged_at).length ?? 0} / {audienceSize(r)}</span> : '—') },
          { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
          { key: '_a', header: '', sortable: false, exportable: false, className: 'text-right', cell: (r) => r.status === 'draft' && <Button size="sm" onClick={(e) => { e.stopPropagation(); publish.mutate(r.id) }}><Send /> Publish</Button> },
        ]} emptyTitle="No posts yet" />
      {edit !== undefined && <CrudDialog cfg={cfg} open onOpenChange={(o) => !o && setEdit(undefined)} editing={edit} />}
    </>
  )
}

export function AnnouncementsPage({ category = 'announcement' }: { category?: Category }) {
  const { can } = useAuth()
  const meta = CAT_META[category]
  return (
    <div>
      <PageHeader title={meta.title} description={meta.desc} />
      {can('engagement.manage') ? (
        <Tabs defaultValue="feed"><TabsList><TabsTrigger value="feed">Feed</TabsTrigger><TabsTrigger value="manage">Manage & track</TabsTrigger></TabsList>
          <TabsContent value="feed"><Feed category={category} /></TabsContent><TabsContent value="manage"><Manage category={category} /></TabsContent></Tabs>
      ) : <Feed category={category} />}
    </div>
  )
}
export const MyAnnouncements = () => (
  <div><PageHeader title="News & announcements" />
    <Tabs defaultValue="a"><TabsList><TabsTrigger value="a">Announcements</TabsTrigger><TabsTrigger value="n">News</TabsTrigger><TabsTrigger value="c">Team updates</TabsTrigger><TabsTrigger value="p">Policies</TabsTrigger></TabsList>
      <TabsContent value="a"><Feed category="announcement" /></TabsContent><TabsContent value="n"><Feed category="news" /></TabsContent><TabsContent value="c"><Feed category="communication" /></TabsContent><TabsContent value="p"><Feed category="policy" /></TabsContent></Tabs>
  </div>
)

/** Employee self-service: everything people take part in, in one place. */
export const EssCommunity = () => (
  <Tabs defaultValue="surveys"><TabsList><TabsTrigger value="surveys">Surveys</TabsTrigger><TabsTrigger value="events">Events</TabsTrigger><TabsTrigger value="recognition">Recognition</TabsTrigger><TabsTrigger value="feedback">Feedback</TabsTrigger></TabsList>
    <TabsContent value="surveys"><SurveysPage /></TabsContent><TabsContent value="events"><EventsPage /></TabsContent>
    <TabsContent value="recognition"><RecognitionPage /></TabsContent><TabsContent value="feedback"><FeedbackSuggestionsPage /></TabsContent></Tabs>
)

const BADGES: Record<string, { label: string; tone: any }> = {
  teamwork: { label: 'Teamwork', tone: 'primary' }, innovation: { label: 'Innovation', tone: 'info' }, customer_first: { label: 'Customer first', tone: 'success' },
  ownership: { label: 'Ownership', tone: 'warning' }, excellence: { label: 'Excellence', tone: 'primary' }, safety: { label: 'Safety', tone: 'danger' },
}
export function RecognitionPage() {
  const { employeeId, orgId } = useMe()
  const q = useQuery({ queryKey: ['engagement', 'recognition'], queryFn: () => unwrap<any[]>(db.from('employee_recognition').select('*, from:employees!employee_recognition_from_employee_id_fkey(first_name, last_name, photo_url), to:employees!employee_recognition_to_employee_id_fkey(first_name, last_name, photo_url)').order('created_at', { ascending: false }).limit(100)) })
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState<string | null>(null); const [badge, setBadge] = useState('teamwork'); const [msg, setMsg] = useState('')
  const give = useAction(() => unwrap(db.from('employee_recognition').insert({ organisation_id: orgId, from_employee_id: employeeId, to_employee_id: to, badge, message: msg }).select('id')), { success: 'Recognition shared', invalidate: [['engagement', 'recognition']], onSuccess: () => { setOpen(false); setMsg(''); setTo(null) } })
  return (
    <div>
      <PageHeader title="Employee recognition" description="Thank colleagues publicly for great work." actions={<Button onClick={() => setOpen(true)}><Award /> Recognise someone</Button>} />
      <QueryView q={q} empty={{ when: (d) => d.length === 0, title: 'No recognitions yet', description: 'Be the first to thank a colleague.' }}>
        {(d) => (
          <div className="grid gap-3 md:grid-cols-2">
            {d.map((r) => (
              <Card key={r.id} className="p-5">
                <div className="flex items-center gap-3">
                  <Avatar name={`${r.to?.first_name} ${r.to?.last_name}`} src={r.to?.photo_url} size={40} />
                  <div className="min-w-0 flex-1"><div className="font-semibold">{r.to?.first_name} {r.to?.last_name}</div><div className="text-xs text-muted">from {r.from?.first_name} {r.from?.last_name} · {ago(r.created_at)}</div></div>
                  <Badge tone={BADGES[r.badge]?.tone}>{BADGES[r.badge]?.label}</Badge>
                </div>
                <p className="mt-3 text-sm leading-relaxed">“{r.message}”</p>
              </Card>
            ))}
          </div>
        )}
      </QueryView>
      <Dialog open={open} onOpenChange={setOpen} title="Recognise a colleague" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={give.isPending} disabled={!to || !msg.trim()} onClick={() => give.mutate()}><ThumbsUp /> Share</Button></>}>
        <div className="space-y-4">
          <Field label="Colleague" required><EmployeePicker value={to} onChange={setTo} filter={(e: any) => e.id !== employeeId} /></Field>
          <Field label="Value"><div className="flex flex-wrap gap-1.5">{Object.entries(BADGES).map(([k, b]) => <button key={k} type="button" onClick={() => setBadge(k)} className={cn('rounded-full border px-3 py-1 text-sm', badge === k ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted')}>{b.label}</button>)}</div></Field>
          <Field label="What did they do?" required><Textarea value={msg} onChange={(e) => setMsg(e.target.value)} /></Field>
        </div>
      </Dialog>
    </div>
  )
}

export function FeedbackSuggestionsPage() {
  const { can } = useAuth()
  const { employeeId, orgId } = useMe()
  const q = useQuery({ queryKey: ['engagement', 'feedback'], queryFn: () => unwrap<any[]>(db.from('employee_feedback').select('*, employees(first_name, last_name), departments(name)').order('created_at', { ascending: false })) })
  const [open, setOpen] = useState(false); const [respond, setRespond] = useState<any | null>(null)
  const [v, setV] = useState({ feedback_type: 'suggestion', subject: '', message: '', is_anonymous: false })
  const [resp, setResp] = useState({ status: 'in_review', response: '' })
  // no read-back after insert: an anonymous row is (rightly) not visible to its sender
  const send = useAction(() => unwrap(db.from('employee_feedback').insert({ ...v, organisation_id: orgId, employee_id: v.is_anonymous ? null : employeeId })), { success: 'Thank you — your feedback was submitted', invalidate: [['engagement', 'feedback']], onSuccess: () => { setOpen(false); setV({ feedback_type: 'suggestion', subject: '', message: '', is_anonymous: false }) } })
  const answer = useAction(() => unwrap(db.from('employee_feedback').update({ status: resp.status, response: resp.response, responded_at: new Date().toISOString() }).eq('id', respond.id).select('id')), { success: 'Response saved', invalidate: [['engagement', 'feedback']], onSuccess: () => setRespond(null) })
  return (
    <div>
      <PageHeader title="Feedback & suggestions" description="Share ideas, concerns or grievances. Anonymous submissions do not store who sent them." actions={<Button onClick={() => setOpen(true)}><Plus /> Share feedback</Button>} />
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} onRowClick={can('engagement.manage') ? (r) => { setResp({ status: r.status, response: r.response ?? '' }); setRespond(r) } : undefined} columns={[
        { key: 'subject', header: 'Subject', cell: (r) => <div><div className="font-medium">{r.subject}</div><div className="line-clamp-1 text-xs text-muted">{r.message}</div></div> },
        { key: 'feedback_type', header: 'Type', value: (r) => titleCase(r.feedback_type) }, { key: 'from', header: 'From', value: (r) => (r.is_anonymous ? 'Anonymous' : `${r.employees?.first_name ?? ''} ${r.employees?.last_name ?? ''}`) },
        { key: 'created_at', header: 'Submitted', cell: (r) => fmtDate(r.created_at) }, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
        { key: 'response', header: 'Response', cell: (r) => <span className="line-clamp-1 max-w-xs text-muted">{r.response}</span>, hideOnMobile: true },
      ]} />
      <Dialog open={open} onOpenChange={setOpen} title="Share feedback" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={send.isPending} disabled={!v.subject || !v.message} onClick={() => send.mutate()}>Submit</Button></>}>
        <div className="space-y-4">
          <Field label="Type"><Select value={v.feedback_type} onChange={(e) => setV({ ...v, feedback_type: e.target.value })}>{['suggestion', 'feedback', 'grievance', 'appreciation'].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</Select></Field>
          <Field label="Subject" required><Input value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} /></Field>
          <Field label="Details" required><Textarea value={v.message} onChange={(e) => setV({ ...v, message: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.is_anonymous} onChange={(e) => setV({ ...v, is_anonymous: e.target.checked })} />Submit anonymously (you won’t be able to track it)</label>
        </div>
      </Dialog>
      <Dialog open={!!respond} onOpenChange={(o) => !o && setRespond(null)} title={respond?.subject ?? ''} description={respond?.message} footer={<><Button variant="secondary" onClick={() => setRespond(null)}>Cancel</Button><Button loading={answer.isPending} onClick={() => answer.mutate()}>Save response</Button></>}>
        <div className="space-y-4">
          <Field label="Status"><Select value={resp.status} onChange={(e) => setResp({ ...resp, status: e.target.value })}>{['open', 'in_review', 'resolved', 'closed'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select></Field>
          <Field label="Response (visible to the submitter)"><Textarea value={resp.response} onChange={(e) => setResp({ ...resp, response: e.target.value })} /></Field>
        </div>
      </Dialog>
    </div>
  )
}

export function SurveysPage() {
  const { can } = useAuth()
  const surveys = useQuery({ queryKey: ['engagement', 'surveys'], queryFn: () => unwrap<any[]>(db.from('surveys').select('*, survey_questions(id)').order('created_at', { ascending: false })) })
  const mine = useQuery({ queryKey: ['engagement', 'participation'], queryFn: () => unwrap<any[]>(db.from('survey_participation').select('survey_id')) })
  const done = new Set((mine.data ?? []).map((m) => m.survey_id))
  const [take, setTake] = useState<any | null>(null); const [results, setResults] = useState<any | null>(null); const [build, setBuild] = useState<any | null>(null)
  return (
    <div>
      <PageHeader title="Surveys" description="Pulse and engagement surveys. Anonymous surveys record only that you responded, not what you answered." />
      <QueryView q={surveys} empty={{ when: (d) => d.length === 0, title: 'No surveys yet' }}>
        {(d) => (
          <div className="grid gap-3 md:grid-cols-2">
            {d.map((s) => (
              <Card key={s.id} className="flex flex-col p-5">
                <div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{s.title}</h3><StatusBadge status={s.status} /></div>
                <p className="mt-1 flex-1 text-sm text-muted">{s.description}</p>
                <p className="mt-3 text-xs text-subtle">{s.survey_questions?.length ?? 0} questions · open {fmtDate(s.starts_on)} – {fmtDate(s.ends_on)}{s.is_anonymous && ' · anonymous'}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {s.status === 'active' && (!(s.starts_on <= isoDate() && isoDate() <= s.ends_on) ? <Badge>{isoDate() < s.starts_on ? `Opens ${fmtDate(s.starts_on)}` : 'Closed'}</Badge> : done.has(s.id) ? <Badge tone="success">You responded</Badge> : <Button size="sm" onClick={() => setTake(s)}>Take survey</Button>)}
                  {can('engagement.manage') && <><Button size="sm" variant="secondary" onClick={() => setResults(s)}><BarChart2 /> Results</Button><Button size="sm" variant="ghost" onClick={() => setBuild(s)}>Questions</Button></>}
                </div>
              </Card>
            ))}
          </div>
        )}
      </QueryView>
      {can('engagement.manage') && <div className="mt-6"><CrudPage cfg={{
        title: 'Manage surveys', embedded: true, table: 'surveys', permission: 'engagement.manage', queryKey: ['engagement', 'surveys'], orderBy: { column: 'created_at', ascending: false }, remove: 'delete',
        columns: [{ key: 'title', header: 'Survey' }, { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> }, { key: 'ends_on', header: 'Closes', cell: (r) => fmtDate(r.ends_on) }, { key: 'is_anonymous', header: 'Anonymous', value: (r) => (r.is_anonymous ? 'Yes' : 'No') }],
        fields: [{ name: 'title', label: 'Title', type: 'text', required: true }, { name: 'description', label: 'Description', type: 'textarea' }, { name: 'starts_on', label: 'Opens', type: 'date', required: true }, { name: 'ends_on', label: 'Closes', type: 'date', required: true },
          { name: 'is_anonymous', label: 'Anonymous responses', type: 'switch', default: true }, { name: 'status', label: 'Status', type: 'select', required: true, default: 'draft', options: ['draft', 'active', 'closed'].map((v) => ({ value: v, label: titleCase(v) })) }],
      }} /></div>}
      {take && <TakeSurvey survey={take} onClose={() => setTake(null)} />}
      {results && <SurveyResults survey={results} onClose={() => setResults(null)} />}
      {build && <Dialog open onOpenChange={(o) => !o && setBuild(null)} title={`Questions · ${build.title}`} size="lg"><CrudPage cfg={{
        title: 'Questions', embedded: true, table: 'survey_questions', orgScoped: false, permission: 'engagement.manage', queryKey: ['engagement', 'questions', build.id], filter: (q) => q.eq('survey_id', build.id), orderBy: { column: 'sort_order' }, remove: 'delete',
        transform: (v) => ({ ...v, survey_id: build.id, options: typeof v.options === 'string' && v.options ? v.options.split(',').map((x: string) => x.trim()).filter(Boolean) : null }),
        columns: [{ key: 'sort_order', header: '#' }, { key: 'question', header: 'Question' }, { key: 'question_type', header: 'Type', value: (r) => titleCase(r.question_type) }, { key: 'options', header: 'Options', value: (r) => r.options?.join(', ') }],
        fields: [{ name: 'question', label: 'Question', type: 'text', required: true, wide: true }, { name: 'question_type', label: 'Type', type: 'select', required: true, default: 'rating', options: ['rating', 'single_choice', 'yes_no', 'text'].map((v) => ({ value: v, label: titleCase(v) })) },
          { name: 'options', label: 'Choices (comma-separated)', type: 'text', showIf: (v) => v.question_type === 'single_choice' }, { name: 'sort_order', label: 'Order', type: 'number', default: 1, required: true }, { name: 'is_required', label: 'Required', type: 'switch', default: true }],
      }} /></Dialog>}
    </div>
  )
}

function TakeSurvey({ survey, onClose }: { survey: any; onClose: () => void }) {
  const qs = useQuery({ queryKey: ['engagement', 'questions', survey.id], queryFn: () => unwrap<any[]>(db.from('survey_questions').select('*').eq('survey_id', survey.id).order('sort_order')) })
  const [a, setA] = useState<Record<string, string>>({})
  const submit = useAction(() => rpc('submit_survey', { p_survey: survey.id, p_answers: a }), { success: 'Thanks for responding', invalidate: [['engagement']], onSuccess: onClose })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={survey.title} description={survey.is_anonymous ? 'Your answers are anonymous.' : undefined} size="lg" footer={<Button loading={submit.isPending} onClick={() => submit.mutate()}>Submit</Button>}>
      <div className="space-y-5">
        {(qs.data ?? []).map((q, i) => (
          <div key={q.id}>
            <p className="mb-2 text-sm font-medium">{i + 1}. {q.question}{q.is_required && <span className="text-danger"> *</span>}</p>
            {q.question_type === 'rating' && <div className="flex gap-1.5">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" onClick={() => setA({ ...a, [q.id]: String(n) })} className={cn('h-10 w-10 rounded-md border text-sm', a[q.id] === String(n) ? 'border-primary bg-primary text-primary-fg' : 'border-line hover:bg-raised')}>{n}</button>)}<span className="ml-2 self-center text-xs text-muted">1 = strongly disagree, 5 = strongly agree</span></div>}
            {q.question_type === 'yes_no' && <div className="flex gap-2">{['Yes', 'No'].map((o) => <button key={o} type="button" onClick={() => setA({ ...a, [q.id]: o })} className={cn('rounded-md border px-4 py-1.5 text-sm', a[q.id] === o ? 'border-primary bg-primary-soft text-primary' : 'border-line')}>{o}</button>)}</div>}
            {q.question_type === 'single_choice' && <div className="flex flex-wrap gap-2">{(q.options ?? []).map((o: string) => <button key={o} type="button" onClick={() => setA({ ...a, [q.id]: o })} className={cn('rounded-md border px-3 py-1.5 text-sm', a[q.id] === o ? 'border-primary bg-primary-soft text-primary' : 'border-line')}>{o}</button>)}</div>}
            {q.question_type === 'text' && <Textarea value={a[q.id] ?? ''} onChange={(e) => setA({ ...a, [q.id]: e.target.value })} />}
          </div>
        ))}
      </div>
    </Dialog>
  )
}

function SurveyResults({ survey, onClose }: { survey: any; onClose: () => void }) {
  const qs = useQuery({ queryKey: ['engagement', 'questions', survey.id], queryFn: () => unwrap<any[]>(db.from('survey_questions').select('*').eq('survey_id', survey.id).order('sort_order')) })
  const ans = useQuery({ queryKey: ['engagement', 'answers', survey.id], queryFn: () => unwrap<any[]>(db.from('survey_answers').select('question_id, answer_text, answer_number, survey_responses!inner(survey_id)').eq('survey_responses.survey_id', survey.id)) })
  const resp = useQuery({ queryKey: ['engagement', 'resp-count', survey.id], queryFn: async () => (await db.from('survey_participation').select('employee_id', { count: 'exact', head: true }).eq('survey_id', survey.id)).count ?? 0 })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Results · ${survey.title}`} description={`${resp.data ?? 0} responses`} size="lg">
      <div className="space-y-5">
        {survey.is_anonymous && (resp.data ?? 0) < 3 && <EmptyState title="Results are hidden for now" description={`To keep this anonymous survey anonymous, answers appear once at least 3 people have responded (${resp.data ?? 0} so far).`} icon={Users} />}
        {(!survey.is_anonymous || (resp.data ?? 0) >= 3) && (qs.data ?? []).map((q) => {
          const as = (ans.data ?? []).filter((a) => a.question_id === q.id)
          const counts = as.reduce<Record<string, number>>((m, a) => ({ ...m, [a.answer_text]: (m[a.answer_text] ?? 0) + 1 }), {})
          const avg = q.question_type === 'rating' && as.length ? (as.reduce((s, a) => s + Number(a.answer_number), 0) / as.length).toFixed(2) : null
          return (
            <Card key={q.id} className="p-4">
              <p className="text-sm font-medium">{q.question}</p>
              {avg && <p className="figure mt-1 text-2xl">{avg}<span className="text-sm text-muted"> / 5 average</span></p>}
              {q.question_type !== 'text' ? (
                <div className="mt-2 space-y-1">{Object.entries(counts).sort().map(([k, n]) => <div key={k} className="flex items-center gap-2 text-sm"><span className="w-28 truncate">{k}</span><div className="h-2 flex-1 rounded bg-line"><div className="h-2 rounded bg-primary" style={{ width: `${(n / Math.max(1, as.length)) * 100}%` }} /></div><span className="w-8 text-right tnum text-muted">{n}</span></div>)}</div>
              ) : <ul className="mt-2 space-y-1 text-sm text-muted">{as.map((a, i) => <li key={i}>“{a.answer_text}”</li>)}{as.length === 0 && <li>No comments</li>}</ul>}
            </Card>
          )
        })}
      </div>
    </Dialog>
  )
}

export function EventsPage() {
  const { can } = useAuth()
  const { employeeId } = useMe()
  const q = useQuery({ queryKey: ['engagement', 'events'], queryFn: () => unwrap<any[]>(db.from('company_events').select('*, event_rsvps(employee_id, response)').gte('starts_at', new Date(Date.now() - 864e5).toISOString()).order('starts_at')) })
  const rsvp = useAction(({ id, response }: { id: string; response: string }) => unwrap(db.from('event_rsvps').upsert({ event_id: id, employee_id: employeeId, response, responded_at: new Date().toISOString() }).select('event_id')), { success: 'RSVP saved', invalidate: [['engagement', 'events']] })
  return (
    <div className="space-y-6">
      <PageHeader title="Employee events" description="Town halls, trainings, celebrations and more." />
      <QueryView q={q} empty={{ when: (d) => d.length === 0, title: 'No upcoming events' }}>
        {(d) => (
          <div className="grid gap-3 md:grid-cols-2">
            {d.map((e) => {
              const mine = e.event_rsvps?.find((r: any) => r.employee_id === employeeId)?.response
              const going = e.event_rsvps?.filter((r: any) => r.response === 'going').length ?? 0
              return (
                <Card key={e.id} className="flex gap-4 p-5">
                  <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-lg bg-primary-soft text-primary"><span className="text-xs">{fmtDate(e.starts_at, 'MMM')}</span><span className="figure text-xl font-semibold leading-none">{fmtDate(e.starts_at, 'd')}</span></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><h3 className="font-semibold">{e.title}</h3><Badge>{titleCase(e.event_type)}</Badge></div>
                    <p className="mt-0.5 text-xs text-muted"><CalendarDays className="mr-1 inline h-3 w-3" />{fmtDate(e.starts_at, 'EEE, HH:mm')}{e.ends_at && `–${fmtDate(e.ends_at, 'HH:mm')}`}{e.venue && <><MapPin className="ml-2 mr-1 inline h-3 w-3" />{e.venue}</>}</p>
                    {e.description && <p className="mt-2 text-sm text-muted">{e.description}</p>}
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {['going', 'maybe', 'not_going'].map((r) => <button key={r} onClick={() => rsvp.mutate({ id: e.id, response: r })} className={cn('rounded-full border px-3 py-1 text-xs', mine === r ? 'border-primary bg-primary text-primary-fg' : 'border-line text-muted hover:bg-raised')}>{titleCase(r)}</button>)}
                      <span className="ml-2 text-xs text-subtle"><Users className="mr-1 inline h-3 w-3" />{going} going</span>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </QueryView>
      {can('engagement.manage') && <CrudPage cfg={{
        title: 'Manage events', embedded: true, table: 'company_events', permission: 'engagement.manage', queryKey: ['engagement', 'events-admin'], orderBy: { column: 'starts_at', ascending: false }, remove: 'delete',
        columns: [{ key: 'title', header: 'Event' }, { key: 'event_type', header: 'Type', value: (r) => titleCase(r.event_type) }, { key: 'starts_at', header: 'Starts', cell: (r) => fmtDateTime(r.starts_at) }, { key: 'venue', header: 'Venue' }],
        fields: [{ name: 'title', label: 'Title', type: 'text', required: true }, { name: 'event_type', label: 'Type', type: 'select', required: true, default: 'celebration', options: ['celebration', 'training', 'town_hall', 'sports', 'csr', 'other'].map((v) => ({ value: v, label: titleCase(v) })) },
          { name: 'starts_at', label: 'Starts', type: 'datetime', required: true }, { name: 'ends_at', label: 'Ends', type: 'datetime' }, { name: 'venue', label: 'Venue', type: 'text' }, { name: 'description', label: 'Description', type: 'textarea' }],
      }} />}
    </div>
  )
}

export function NotificationsPage() {
  const n = useNotifications()
  const [filter, setFilter] = useState('all')
  const rows = (n.data ?? []).filter((x) => filter === 'all' || (filter === 'unread' ? !x.read_at : x.category === filter))
  return (
    <div>
      <PageHeader title="Notifications" description="Everything generated from approvals, attendance, payroll, learning and announcements." actions={n.unread > 0 && <Button variant="secondary" onClick={n.markAll}><CheckCheck /> Mark all read</Button>} />
      <div className="mb-3 flex flex-wrap gap-1.5">{['all', 'unread', 'approvals', 'attendance', 'payroll', 'claims', 'learning', 'announcements', 'performance', 'celebrations'].map((f) => <button key={f} onClick={() => setFilter(f)} className={cn('rounded-full border px-3 py-1 text-xs', filter === f ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted')}>{titleCase(f)}</button>)}</div>
      <Card>{rows.length === 0 ? <EmptyState title="No notifications" icon={Megaphone} /> : (
        <ul className="divide-y divide-line">{rows.map((x) => (
          <li key={x.id} className={cn('flex gap-3 px-5 py-3', !x.read_at && 'bg-primary-soft/30')}>
            <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', x.read_at ? 'bg-line' : 'bg-primary')} />
            <div className="min-w-0 flex-1"><div className="text-sm font-medium">{x.title}</div>{x.body && <div className="text-sm text-muted">{x.body}</div>}<div className="mt-1 text-xs text-subtle">{titleCase(x.category)} · {ago(x.created_at)}</div></div>
            {!x.read_at && <Button size="sm" variant="ghost" onClick={() => n.markOne(x.id)}>Mark read</Button>}
          </li>
        ))}</ul>
      )}</Card>
    </div>
  )
}
