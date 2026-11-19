import { supabase } from './supabase'

/** Turn the auth server's replies into something HR can act on. */
export function explainAdminError(raw: string): string {
  const m = raw.toLowerCase()
  if (m.includes('not authorized') || m.includes('email_address_not_authorized'))
    return 'Supabase did not send the email: its built-in mail service only delivers to members of your Supabase team. Set up your own SMTP (Supabase › Authentication › Emails › SMTP settings) to email employees.'
  if (m.includes('rate limit') || m.includes('over_email_send_rate_limit'))
    return 'Too many emails were sent in the last hour (the built-in Supabase mail service allows about 2 per hour). Wait and try again, or set up your own SMTP to raise the limit.'
  if (m.includes('already been registered') || m.includes('already registered') || m.includes('already exists'))
    return 'This email already has an account. Use "Reset password" in User management instead of a new invite.'
  if (m.includes('failed to send a request') || m.includes('functionsfetcherror') || m.includes('not found'))
    return `${raw}. The admin-users edge function is not reachable — check that it is deployed (see docs/DEPLOYMENT.md).`
  return raw
}

/** Call the admin-users edge function and surface its own error message, not the generic "non-2xx" one. */
export async function adminUsers<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body: { ...body, site_url: window.location.origin } })
  if (error) {
    let msg = error.message
    try { msg = (await (error as any).context?.json())?.error ?? msg } catch { /* not JSON */ }
    throw new Error(explainAdminError(msg))
  }
  return data as T
}
