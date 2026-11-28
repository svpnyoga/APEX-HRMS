import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { db, unwrap } from '@/lib/api'
import { adminUsers } from '@/lib/admin-users'
import { useMe } from '@/app/auth'
import { useAction } from '@/hooks/data'
import { LookupSelect } from '@/components/crud/CrudPage'
import { EmployeePicker } from '@/components/common/pickers'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/input'
import { Switch } from '@/components/ui/misc'
import { toast } from 'sonner'

const schema = z.object({
  employee_code: z.string().trim().max(30, 'Keep it under 30 characters').regex(/^[A-Za-z0-9/_-]*$/, 'Use letters, numbers, - / _ only').default(''),
  first_name: z.string().trim().min(1, 'First name is required'),
  last_name: z.string().trim().default(''),
  official_email: z.string().trim().email('Enter a valid email').or(z.literal('')),
  personal_email: z.string().trim().email('Enter a valid email').or(z.literal('')),
  mobile: z.string().trim().regex(/^[+\d\s-]{0,16}$/, 'Digits only').or(z.literal('')),
  date_of_birth: z.string().optional(),
  gender: z.string().optional(),
  address_line: z.string().optional(), city: z.string().optional(), state: z.string().optional(), postal_code: z.string().optional(),
  date_of_joining: z.string().min(1, 'Joining date is required'),
  probation_end_date: z.string().optional(),
  employment_type: z.string().min(1),
  department_ids: z.array(z.string()).default([]), designation_id: z.string().nullable().optional(),
  reporting_manager_id: z.string().nullable().optional(), location_id: z.string().nullable().optional(), shift_id: z.string().nullable().optional(),
  is_field_employee: z.boolean().default(false),
  notice_period_days: z.coerce.number().min(0).max(180),
  invite: z.boolean().default(false),
}).refine((v) => !v.invite || !!v.official_email, { message: 'An official email is needed to send a login invite', path: ['official_email'] })

type Values = z.infer<typeof schema>
const blank = (v?: string | null) => (v === '' || v === undefined ? null : v)

export function EmployeeForm({ open, onOpenChange, employee, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; employee?: any; onSaved?: (id: string) => void }) {
  const { orgId } = useMe()
  const form = useForm<Values>({ resolver: zodResolver(schema) as any })
  useEffect(() => {
    if (!open) return
    form.reset({
      employee_code: employee?.employee_code ?? '', first_name: employee?.first_name ?? '', last_name: employee?.last_name ?? '', official_email: employee?.official_email ?? '', personal_email: employee?.personal_email ?? '',
      mobile: employee?.mobile ?? '', date_of_birth: employee?.date_of_birth ?? '', gender: employee?.gender ?? '', address_line: employee?.address_line ?? '',
      city: employee?.city ?? '', state: employee?.state ?? 'Tamil Nadu', postal_code: employee?.postal_code ?? '',
      date_of_joining: employee?.date_of_joining ?? new Date().toISOString().slice(0, 10), probation_end_date: employee?.probation_end_date ?? '',
      employment_type: employee?.employment_type ?? 'full_time', department_ids: employee?.department_ids?.length ? employee.department_ids : employee?.department_id ? [employee.department_id] : [], designation_id: employee?.designation_id ?? null,
      reporting_manager_id: employee?.reporting_manager_id ?? null, location_id: employee?.location_id ?? null, shift_id: employee?.shift_id ?? null,
      is_field_employee: employee?.is_field_employee ?? false, notice_period_days: employee?.notice_period_days ?? 30, invite: false,
    })
  }, [open, employee]) // eslint-disable-line

  const save = useAction(async (v: Values) => {
    const { invite, ...rest } = v
    const payload: Record<string, any> = Object.fromEntries(Object.entries(rest).map(([k, x]) => [k, typeof x === 'string' ? blank(x) : x]))
    payload.last_name = v.last_name ?? ''
    payload.department_ids = v.department_ids ?? []; payload.department_id = v.department_ids?.[0] ?? null   // first = main department
    if (!payload.employee_code) delete payload.employee_code      // blank: new → automatic ID; edit → keep the current one
    let id = employee?.id
    const taken = (err: unknown) => /duplicate|unique/i.test(String((err as Error)?.message)) ? new Error(`Employee ID ${v.employee_code} is already used by someone else`) : err
    if (employee) await unwrap(db.from('employees').update(payload).eq('id', employee.id).select('id')).catch((err) => { throw taken(err) })
    else {
      // Generate the id here and skip RETURNING: the read-back policy (can_view_employee) runs against a
      // snapshot that does not contain the new row yet, so insert(...).select() is always rejected by RLS.
      id = crypto.randomUUID()
      await unwrap(db.from('employees').insert({ ...payload, id, organisation_id: orgId })).catch((err) => { throw taken(err) })
    }
    if (invite) {
      try {
        await adminUsers({ action: 'invite', employee_id: id, email: v.official_email, full_name: `${v.first_name} ${v.last_name}`.trim(), roles: [v.is_field_employee ? 'field_employee' : 'employee'] })
        toast.success('Login invite sent')
      } catch (err) {
        toast.error(`Employee saved, but the invite was not sent: ${(err as Error).message}`, { duration: 15000 })
      }
    }
    return id as string
  }, { success: employee ? 'Employee updated' : 'Employee created', invalidate: [['directory'], ['employee'], ['crud', 'employees']], onSuccess: (id) => { onOpenChange(false); onSaved?.(id) } })

  const e = form.formState.errors
  const r = form.register
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={employee ? `Edit ${employee.first_name}` : 'New employee'} description={employee ? undefined : 'Leave Employee ID blank to get the next one automatically.'} size="lg"
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={save.isPending} onClick={form.handleSubmit((v) => save.mutate(v))}>{employee ? 'Save changes' : 'Create employee'}</Button></>}>
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="space-y-6">
        <section>
          <h4 className="mb-3 text-sm font-semibold">Personal</h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Employee ID" error={e.employee_code?.message} hint={employee ? 'Change only if you need to; must be unique' : 'Blank = next automatic ID'}><Input {...r('employee_code')} placeholder={employee ? '' : 'Automatic'} aria-invalid={!!e.employee_code} /></Field>
            <div className="hidden sm:block" />
            <Field label="First name" required error={e.first_name?.message}><Input {...r('first_name')} aria-invalid={!!e.first_name} /></Field>
            <Field label="Last name"><Input {...r('last_name')} /></Field>
            <Field label="Official email" error={e.official_email?.message}><Input type="email" {...r('official_email')} aria-invalid={!!e.official_email} /></Field>
            <Field label="Personal email" error={e.personal_email?.message}><Input type="email" {...r('personal_email')} /></Field>
            <Field label="Mobile" error={e.mobile?.message}><Input {...r('mobile')} inputMode="tel" /></Field>
            <Field label="Date of birth"><Input type="date" {...r('date_of_birth')} /></Field>
            <Field label="Gender"><Select {...r('gender')}><option value="">—</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option><option value="undisclosed">Prefer not to say</option></Select></Field>
            <Field label="City"><Input {...r('city')} /></Field>
            <Field label="Address" className="sm:col-span-2"><Input {...r('address_line')} /></Field>
            <Field label="State"><Input {...r('state')} /></Field>
            <Field label="PIN code"><Input {...r('postal_code')} inputMode="numeric" /></Field>
          </div>
        </section>
        <section>
          <h4 className="mb-3 text-sm font-semibold">Employment</h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date of joining" required error={e.date_of_joining?.message}><Input type="date" {...r('date_of_joining')} /></Field>
            <Field label="Probation ends"><Input type="date" {...r('probation_end_date')} /></Field>
            <Field label="Employment type" required><Select {...r('employment_type')}>{['full_time', 'part_time', 'contract', 'intern', 'consultant', 'trainee'].map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}</Select></Field>
            <Field label="Notice period (days)"><Input type="number" {...r('notice_period_days')} /></Field>
            <Field label="Departments" className="sm:col-span-2" hint="Tick every department this person works in. The first one ticked is the main department (used for reports and payroll); tap ★ to make another one main."><Controller control={form.control} name="department_ids" render={({ field }) => <DepartmentsPicker value={field.value ?? []} onChange={field.onChange} />} /></Field>
            <Field label="Designation"><Controller control={form.control} name="designation_id" render={({ field }) => <LookupSelect def={{ name: 'designation_id', label: 'Designation', type: 'lookup', lookup: { table: 'designations', filter: (q) => q.is('deleted_at', null) } }} value={field.value} onChange={field.onChange} />} /></Field>
            <Field label="Reporting manager"><Controller control={form.control} name="reporting_manager_id" render={({ field }) => <EmployeePicker value={field.value} onChange={field.onChange} allowClear filter={(x: any) => x.id !== employee?.id} />} /></Field>
            <Field label="Shift"><Controller control={form.control} name="shift_id" render={({ field }) => <LookupSelect def={{ name: 'shift_id', label: 'Shift', type: 'lookup', lookup: { table: 'shifts', filter: (q) => q.eq('is_active', true) } }} value={field.value} onChange={field.onChange} />} /></Field>
            <Controller control={form.control} name="is_field_employee" render={({ field }) => (
              <label className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm sm:mt-6">Field employee (site attendance & tracking)<Switch checked={field.value} onCheckedChange={field.onChange} /></label>
            )} />
          </div>
        </section>
        {!employee?.user_id && (
          <Controller control={form.control} name="invite" render={({ field }) => (
            <label className="flex items-center justify-between rounded-md bg-raised px-3 py-2.5 text-sm"><span><span className="font-medium">Send a login invite</span><span className="block text-xs text-muted">Emails a secure sign-up link to the official email and links the account to this employee.</span></span><Switch checked={field.value} onCheckedChange={field.onChange} /></label>
          )} />
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

/** tick any number of departments; the first in the list is the main one */
function DepartmentsPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const deps = useQuery({ queryKey: ['crud', 'departments', 'picker'], queryFn: () => unwrap<any[]>(db.from('departments').select('id, name').is('deleted_at', null).order('name')) })
  const list = deps.data ?? []
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  const makeMain = (id: string) => onChange([id, ...value.filter((x) => x !== id)])
  if (deps.isLoading) return <p className="text-sm text-muted">Loading departments…</p>
  if (!list.length) return <p className="text-sm text-muted">No departments yet — add them in Employees → Departments.</p>
  return (
    <div className="flex flex-wrap gap-2">
      {list.map((d) => {
        const on = value.includes(d.id), main = value[0] === d.id
        return (
          <span key={d.id} className={`inline-flex items-center rounded-full border text-sm ${on ? 'border-primary bg-primary/10 text-primary' : 'border-line text-muted'}`}>
            <button type="button" onClick={() => toggle(d.id)} className="px-3 py-1.5" aria-pressed={on}>{on ? '✓ ' : ''}{d.name}</button>
            {on && <button type="button" onClick={() => makeMain(d.id)} title={main ? 'Main department' : 'Make this the main department'} className={`pr-3 ${main ? '' : 'opacity-40 hover:opacity-100'}`}>★{main ? ' Main' : ''}</button>}
          </span>
        )
      })}
    </div>
  )
}
