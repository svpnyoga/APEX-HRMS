import { useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, CheckCircle2, Clock, Eye, EyeOff, KeyRound, LogOut, MailCheck, RefreshCw, UserPlus, XCircle } from 'lucide-react'
import { supabase, isConfigured } from '@/lib/supabase'
import { rpc } from '@/lib/api'
import { useAuth } from '@/app/auth'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { cn, errorMessage, ago } from '@/lib/utils'
import { AuthFrame } from './pages'
import { SIGNUP_ROLES, formatJoinCode, passwordProblems } from './roles'

type Mode = 'join' | 'create'
export type CompanyDetails = {
  full_name: string; mobile: string
  join_code: string; requested_role: string; job_title: string; message: string
  company_name: string; city: string; state: string
}
const emptyDetails: CompanyDetails = { full_name: '', mobile: '', join_code: '', requested_role: 'employee', job_title: '', message: '', company_name: '', city: '', state: '' }

type SignupMeta = { mode: Mode } & Partial<CompanyDetails>
type Status = {
  email: string; email_confirmed: boolean; has_profile: boolean; active: boolean; can_create_organisation: boolean
  request: null | { id: string; status: 'pending' | 'approved' | 'rejected'; organisation_name: string; requested_role: string; requested_role_name: string; decision_note: string | null; created_at: string; decided_at: string | null }
}

function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const opt = (m: Mode, Icon: typeof UserPlus, title: string, sub: string) => (
    <button type="button" onClick={() => onChange(m)} aria-pressed={mode === m}
      className={cn('flex flex-1 items-start gap-2.5 rounded-lg border p-3 text-left transition-colors', mode === m ? 'border-primary bg-primary-soft' : 'border-line hover:bg-raised')}>
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', mode === m ? 'text-primary' : 'text-subtle')} />
      <span><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-muted">{sub}</span></span>
    </button>
  )
  return <div className="flex gap-2">{opt('join', UserPlus, 'Join my company', 'I have a company code')}{opt('create', Building2, 'Register a company', 'I am setting it up')}</div>
}

/** The organisation-specific part of sign-up; shared by the sign-up page and the account-setup screen. */
function CompanyFields({ mode, value, onChange }: { mode: Mode; value: CompanyDetails; onChange: (v: CompanyDetails) => void }) {
  const set = (k: keyof CompanyDetails) => (e: { target: { value: string } }) => onChange({ ...value, [k]: k === 'join_code' ? formatJoinCode(e.target.value) : e.target.value })
  const role = SIGNUP_ROLES.find((r) => r.code === value.requested_role)
  if (mode === 'create') return (
    <>
      <Field label="Company name" required><Input value={value.company_name} onChange={set('company_name')} autoComplete="organization" required /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="City"><Input value={value.city} onChange={set('city')} autoComplete="address-level2" /></Field>
        <Field label="State"><Input value={value.state} onChange={set('state')} autoComplete="address-level1" /></Field>
      </div>
      <p className="rounded-md bg-info-soft p-3 text-xs text-info">You will be the company’s administrator. Afterwards, share the company code from <b>User management › Sign-up settings</b> with your staff so they can request access.</p>
    </>
  )
  return (
    <>
      <Field label="Company code" required hint="Ask your HR team. It looks like ABCD-EFGH-JKLM.">
        <Input value={value.join_code} onChange={set('join_code')} placeholder="XXXX-XXXX-XXXX" autoComplete="off" spellCheck={false} className="font-mono tracking-wider" required />
      </Field>
      <Field label="I am joining as" required hint={role?.hint}>
        <Select value={value.requested_role} onChange={set('requested_role')}>{SIGNUP_ROLES.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</Select>
      </Field>
      <Field label="Job title"><Input value={value.job_title} onChange={set('job_title')} placeholder="e.g. CNC operator" /></Field>
      <Field label="Note for the administrator" hint="Optional — department, employee number, who you report to."><Textarea rows={2} value={value.message} onChange={set('message')} maxLength={1000} /></Field>
    </>
  )
}

function detailsProblem(mode: Mode, d: CompanyDetails): string | null {
  if (d.full_name.trim().length < 2) return 'Enter your full name'
  if (mode === 'create') return d.company_name.trim().length < 2 ? 'Enter your company name' : null
  return d.join_code.replace(/-/g, '').length !== 12 ? 'The company code has 12 characters' : null
}

async function submitDetails(mode: Mode, d: CompanyDetails): Promise<void> {
  if (mode === 'create') {
    await rpc('create_organisation_account', { p_company_name: d.company_name, p_full_name: d.full_name, p_mobile: d.mobile || null, p_city: d.city || null, p_state: d.state || null })
    return
  }
  const r = await rpc<{ ok: boolean; error?: string }>('request_access', {
    p_join_code: d.join_code, p_full_name: d.full_name, p_requested_role: d.requested_role,
    p_mobile: d.mobile || null, p_job_title: d.job_title || null, p_message: d.message || null,
  })
  if (!r.ok) throw new Error(r.error ?? 'The request could not be sent')
}

// ---------------------------------------------------------------- sign-up page
export function SignupPage() {
  const { session } = useAuth()
  const opts = useQuery({ queryKey: ['signup-options'], enabled: isConfigured, retry: 0, queryFn: () => rpc<{ can_create_organisation: boolean }>('signup_options') })
  const canCreate = !!opts.data?.can_create_organisation
  const [mode, setMode] = useState<Mode>('join')
  useEffect(() => { if (canCreate) setMode('create') }, [canCreate])
  const [d, setD] = useState<CompanyDetails>(emptyDetails)
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [sentTo, setSentTo] = useState<string | null>(null)
  if (session) return <Navigate to="/" replace />

  const effMode: Mode = canCreate ? mode : 'join'
  const pwProblem = pw ? passwordProblems(pw) : null
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null)
    const p = detailsProblem(effMode, d) ?? passwordProblems(pw) ?? (pw !== pw2 ? 'Passwords do not match' : null)
    if (p) { setErr(p); return }
    setBusy(true)
    try {
      const meta: SignupMeta = effMode === 'create'
        ? { mode: 'create', full_name: d.full_name.trim(), mobile: d.mobile, company_name: d.company_name.trim(), city: d.city, state: d.state }
        : { mode: 'join', full_name: d.full_name.trim(), mobile: d.mobile, join_code: d.join_code, requested_role: d.requested_role, job_title: d.job_title, message: d.message }
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(), password: pw,
        options: { emailRedirectTo: `${location.origin}/`, data: { full_name: d.full_name.trim(), signup: meta } },
      })
      if (error) throw error
      // With email confirmation on (recommended) there is no session yet.
      if (!data.session) setSentTo(email.trim())
    } catch (e) { setErr(errorMessage(e)) } finally { setBusy(false) }
  }

  if (sentTo) return (
    <AuthFrame title="Check your email" subtitle={`We sent a confirmation link to ${sentTo}.`}>
      <div className="space-y-4 text-sm text-muted">
        <div className="flex items-start gap-3 rounded-lg border border-line p-4"><MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <p>Open the link to confirm your address. {effMode === 'join' ? 'Your request then goes to your company’s administrator — you can sign in once they approve it.' : 'Your company is created as soon as you confirm.'}</p></div>
        <p className="text-xs text-subtle">No email after a few minutes? Check spam, or sign up again with the same address to resend it.</p>
        <Link to="/login" className="inline-block text-primary hover:underline">Back to sign in</Link>
      </div>
    </AuthFrame>
  )

  return (
    <AuthFrame title="Create an account" subtitle={effMode === 'create' ? 'Set up your company on Apex HRMS.' : 'Request access to your company. An administrator approves every new account.'}>
      {!isConfigured && <div className="mb-4 rounded-md bg-warning-soft p-3 text-sm text-warning">Supabase is not configured. Copy <code>.env.example</code> to <code>.env</code> and set your project URL and anon key.</div>}
      <form onSubmit={submit} className="space-y-4">
        {canCreate && <ModeSwitch mode={mode} onChange={(m) => { setMode(m); setErr(null) }} />}
        <Field label="Full name" required><Input value={d.full_name} onChange={(e) => setD({ ...d, full_name: e.target.value })} autoComplete="name" required autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Work email" required><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></Field>
          <Field label="Mobile"><Input type="tel" value={d.mobile} onChange={(e) => setD({ ...d, mobile: e.target.value })} autoComplete="tel" /></Field>
        </div>
        <CompanyFields mode={effMode} value={d} onChange={setD} />
        <Field label="Password" required error={pwProblem ?? undefined} hint={!pw ? '10+ characters with upper- and lower-case letters and a number' : undefined}>
          <div className="relative"><Input type={show ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" className="pr-10" required />
            <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-subtle" aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>
        </Field>
        <Field label="Confirm password" required error={pw2 && pw !== pw2 ? 'Passwords do not match' : undefined}><Input type={show ? 'text' : 'password'} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required /></Field>
        {err && <p className="text-sm text-danger" role="alert">{err}</p>}
        <Button type="submit" size="lg" className="w-full" loading={busy}>{effMode === 'create' ? <><Building2 /> Create company account</> : <><KeyRound /> Request access</>}</Button>
      </form>
      <p className="mt-5 text-sm text-muted">Already have an account? <Link to="/login" className="font-medium text-primary hover:underline">Sign in</Link></p>
    </AuthFrame>
  )
}

// ---------------------------------------------------------------- account setup (signed in, no access yet)
export function AccountSetup() {
  const { session, signOut, refresh } = useAuth()
  const qc = useQueryClient()
  const status = useQuery({
    queryKey: ['signup-status', session?.user.id],
    queryFn: () => rpc<Status>('my_signup_status'),
    refetchInterval: (q) => ((q.state.data as Status | undefined)?.request?.status === 'pending' ? 30_000 : false),
  })
  const meta = (session?.user.user_metadata?.signup ?? null) as SignupMeta | null
  const [mode, setMode] = useState<Mode>(meta?.mode ?? 'join')
  const [d, setD] = useState<CompanyDetails>({ ...emptyDetails, full_name: session?.user.user_metadata?.full_name ?? '', ...(meta ?? {}) } as CompanyDetails)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [editing, setEditing] = useState(false)
  const auto = useRef(false)
  const s = status.data

  const done = () => {
    qc.invalidateQueries({ queryKey: ['signup-status'] })
    refresh()
  }
  const send = async (m: Mode, details: CompanyDetails) => {
    setBusy(true); setErr(null)
    try {
      await submitDetails(m, details)
      // the code has served its purpose; do not keep it in the user's metadata
      await supabase.auth.updateUser({ data: { signup: null } })
      setEditing(false)
      done()
    } catch (e) { setErr(errorMessage(e)) } finally { setBusy(false) }
  }

  // First visit after confirming the email: send what was entered on the sign-up form.
  useEffect(() => {
    if (auto.current || !s || s.has_profile || !meta) return
    if (s.request && s.request.status !== 'rejected') return
    if (meta.mode === 'create' && !s.can_create_organisation) { setMode('join'); return }
    auto.current = true
    const p = detailsProblem(meta.mode, d)
    if (!p) void send(meta.mode, d)
  }, [s]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (s?.has_profile) refresh() }, [s?.has_profile]) // eslint-disable-line react-hooks/exhaustive-deps

  const frame = (title: string, subtitle: string, body: React.ReactNode) => (
    <AuthFrame title={title} subtitle={subtitle}>
      {body}
      <div className="mt-6 flex items-center justify-between border-t border-line pt-4 text-sm">
        <span className="truncate text-muted">{s?.email ?? session?.user.email}</span>
        <Button variant="ghost" size="sm" onClick={signOut}><LogOut /> Sign out</Button>
      </div>
    </AuthFrame>
  )

  if (status.isLoading || (busy && !editing)) return frame('Setting up your account', 'One moment…', <div className="h-20 animate-pulse rounded-lg bg-raised" />)
  if (status.error) return frame('Something went wrong', errorMessage(status.error), <Button onClick={() => status.refetch()}><RefreshCw /> Try again</Button>)
  if (!s) return null

  if (s.has_profile && !s.active) return frame('Your account is inactive', 'Contact HR if you believe this is a mistake.', null)
  if (s.has_profile) return frame('Access approved', 'Loading your workspace…', <div className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-5 w-5" /> You’re in.</div>)

  const r = s.request
  if (r?.status === 'pending' && !editing) return frame('Waiting for approval', `Your request to join ${r.organisation_name} has been sent.`, (
    <div className="space-y-4">
      <div className="rounded-lg border border-line p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-warning"><Clock className="h-4 w-4" /> Pending review</div>
        <dl className="mt-3 grid grid-cols-[110px_1fr] gap-y-1.5 text-sm">
          <dt className="text-muted">Company</dt><dd>{r.organisation_name}</dd>
          <dt className="text-muted">Requested as</dt><dd>{r.requested_role_name}</dd>
          <dt className="text-muted">Sent</dt><dd>{ago(r.created_at)}</dd>
        </dl>
      </div>
      <p className="text-sm text-muted">An administrator has been notified. You will get an email when they decide, and this page updates automatically.</p>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => status.refetch()} loading={status.isFetching}><RefreshCw /> Check now</Button>
        <Button variant="ghost" onClick={() => { setMode('join'); setEditing(true) }}>Change details</Button>
      </div>
    </div>
  ))

  const canCreate = s.can_create_organisation
  const effMode: Mode = canCreate ? mode : 'join'
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const p = detailsProblem(effMode, d)
    if (p) { setErr(p); return }
    void send(effMode, d)
  }
  return frame(
    r?.status === 'rejected' ? 'Request not approved' : 'Finish setting up',
    r?.status === 'rejected' ? `${r.organisation_name} did not approve your request.` : 'Tell us which company you belong to.',
    <form onSubmit={submit} className="space-y-4">
      {r?.status === 'rejected' && r.decision_note && (
        <div className="flex items-start gap-2 rounded-md bg-danger-soft p-3 text-sm text-danger"><XCircle className="mt-0.5 h-4 w-4 shrink-0" /><span><b>Reason:</b> {r.decision_note}</span></div>
      )}
      {canCreate && <ModeSwitch mode={mode} onChange={setMode} />}
      <Field label="Full name" required><Input value={d.full_name} onChange={(e) => setD({ ...d, full_name: e.target.value })} required /></Field>
      <Field label="Mobile"><Input type="tel" value={d.mobile} onChange={(e) => setD({ ...d, mobile: e.target.value })} /></Field>
      <CompanyFields mode={effMode} value={d} onChange={setD} />
      {err && <p className="text-sm text-danger" role="alert">{err}</p>}
      <div className="flex gap-2">
        <Button type="submit" className="flex-1" loading={busy}>{effMode === 'create' ? <><Building2 /> Create company</> : <><KeyRound /> {r ? 'Send again' : 'Request access'}</>}</Button>
        {editing && <Button type="button" variant="secondary" onClick={() => { setEditing(false); setErr(null) }}>Cancel</Button>}
      </div>
    </form>,
  )
}
