import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Eye, EyeOff, LogIn } from 'lucide-react'
import { supabase, isConfigured } from '@/lib/supabase'
import { useAuth } from '@/app/auth'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { errorMessage } from '@/lib/utils'
import { passwordProblems } from './roles'

export function AuthFrame({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-ink lg:block">
        <svg viewBox="0 0 600 600" className="absolute -right-40 top-1/2 h-[760px] w-[760px] -translate-y-1/2 opacity-90" aria-hidden>
          {Array.from({ length: 120 }).map((_, i) => { const a = (i / 120) * Math.PI * 2; const major = i % 10 === 0; const r1 = 250, r2 = r1 + (major ? 22 : 10)
            return <line key={i} x1={300 + Math.cos(a) * r1} y1={300 + Math.sin(a) * r1} x2={300 + Math.cos(a) * r2} y2={300 + Math.sin(a) * r2} stroke="#A5A8FF" strokeOpacity={major ? 0.6 : 0.25} strokeWidth={major ? 2 : 1} /> })}
          <circle cx="300" cy="300" r="250" fill="none" stroke="#A5A8FF" strokeOpacity=".25" />
          <circle cx="300" cy="300" r="180" fill="none" stroke="#A5A8FF" strokeOpacity=".15" strokeDasharray="2 6" />
          <path d="M300 40v40M300 520v40M40 300h40M520 300h40" stroke="#A5A8FF" strokeOpacity=".5" strokeWidth="2" />
        </svg>
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-2.5"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-semibold">A</div><span className="text-lg font-semibold">Apex HRMS</span></div>
          <div className="max-w-md">
            <h2 className="text-[34px] font-semibold leading-tight">People operations, measured precisely.</h2>
            <p className="mt-4 text-ink-muted">Face-verified attendance, leave, payroll, claims, appraisals and learning — one system, one set of rules, enforced in the database.</p>
          </div>
          <p className="text-xs text-ink-muted">Your data is protected by row-level security and private storage.</p>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  )
}

export function LoginPage() {
  const { session } = useAuth()
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [mode, setMode] = useState<'login' | 'forgot'>('login'); const [sent, setSent] = useState(false)
  const [params] = useSearchParams()
  if (session) return <Navigate to={params.get('next') || '/'} replace />
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw new Error(error.message === 'Invalid login credentials' ? 'That email and password combination is not recognised.' : /not confirmed/i.test(error.message) ? 'Please confirm your email first — open the link we sent you when you signed up.' : error.message)
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/reset-password` })
        if (error) throw error
        setSent(true)
      }
    } catch (e) { setErr(errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <AuthFrame title={mode === 'login' ? 'Sign in' : 'Reset your password'} subtitle={mode === 'login' ? 'Use your work email.' : 'We will email you a secure link.'}>
      {!isConfigured && <div className="mb-4 rounded-md bg-warning-soft p-3 text-sm text-warning">Supabase is not configured. Copy <code>.env.example</code> to <code>.env</code> and set your project URL and anon key.</div>}
      {sent ? <p className="rounded-md bg-success-soft p-3 text-sm text-success">If an account exists for {email}, a reset link is on its way.</p> : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Work email"><Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
          {mode === 'login' && (
            <Field label="Password">
              <div className="relative"><Input type={show ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="pr-10" />
                <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-subtle" aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>
            </Field>
          )}
          {err && <p className="text-sm text-danger" role="alert">{err}</p>}
          <Button type="submit" size="lg" className="w-full" loading={busy}>{mode === 'login' ? <><LogIn /> Sign in</> : 'Send reset link'}</Button>
        </form>
      )}
      <button onClick={() => { setMode(mode === 'login' ? 'forgot' : 'login'); setErr(null); setSent(false) }} className="mt-4 text-sm text-primary hover:underline">{mode === 'login' ? 'Forgot password?' : 'Back to sign in'}</button>
      {mode === 'login' && (
        <div className="mt-8 border-t border-line pt-5 text-sm text-muted">
          New here? <Link to="/signup" className="font-medium text-primary hover:underline">Create an account</Link>
          <p className="mt-1 text-xs text-subtle">You will need your company code from HR. Access is granted only after an administrator approves you.</p>
        </div>
      )}
    </AuthFrame>
  )
}

export function ResetPasswordPage() {
  const nav = useNavigate()
  const [a, setA] = useState(''); const [b, setB] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [ready, setReady] = useState(false)
  useEffect(() => { supabase.auth.getSession().then(({ data }) => setReady(!!data.session)); const { data } = supabase.auth.onAuthStateChange((e) => { if (e === 'PASSWORD_RECOVERY' || e === 'SIGNED_IN') setReady(true) }); return () => data.subscription.unsubscribe() }, [])
  const valid = !passwordProblems(a) && a === b
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null)
    const { error } = await supabase.auth.updateUser({ password: a })
    setBusy(false)
    if (error) setErr(error.message); else nav('/')
  }
  return (
    <AuthFrame title="Set a new password" subtitle="At least 10 characters, with upper- and lower-case letters and a number.">
      {!ready ? <p className="text-sm text-muted">Open this page from the link in your email.</p> : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="New password"><Input type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} /></Field>
          <Field label="Confirm password" error={b && a !== b ? 'Passwords do not match' : undefined}><Input type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} /></Field>
          {err && <p className="text-sm text-danger">{err}</p>}
          <Button type="submit" className="w-full" size="lg" disabled={!valid} loading={busy}>Save password</Button>
        </form>
      )}
    </AuthFrame>
  )
}
