import { useMemo, useState, type ReactNode } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { MoreHorizontal, Pencil, Plus, Trash2, Archive } from 'lucide-react'
import { db, unwrap } from '@/lib/api'
import { useAuth, useMe } from '@/app/auth'
import { useAction, useLookup } from '@/hooks/data'
import { DataTable, type Column } from '@/components/common/DataTable'
import { PageHeader } from '@/components/common/page'
import { EmployeePicker } from '@/components/common/pickers'
import { useConfirm } from '@/components/common/confirm'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Switch } from '@/components/ui/misc'
import { Menu, MenuItem } from '@/components/ui/menu'
import { cn } from '@/lib/utils'

/** 'Leave policies' -> 'leave policy', 'Shifts' -> 'shift', 'Addresses' -> 'address'. */
function singular(title: string) {
  const t = title.toLowerCase()
  if (/ies$/.test(t)) return t.replace(/ies$/, 'y')
  if (/(ss|sh|ch|x)es$/.test(t)) return t.replace(/es$/, '')
  return t.replace(/s$/, '')
}

export type FieldDef = {
  name: string
  label: string
  type: 'text' | 'email' | 'textarea' | 'number' | 'date' | 'time' | 'datetime' | 'select' | 'switch' | 'color' | 'weekdays' | 'employee' | 'lookup' | 'tags'
  required?: boolean
  options?: { value: string; label: string }[]
  lookup?: { table: string; label?: string; value?: string; filter?: (q: any) => any; order?: string }
  hint?: string
  min?: number
  max?: number
  step?: number
  wide?: boolean
  default?: unknown
  showIf?: (v: Record<string, any>) => boolean
}

export type CrudConfig = {
  title: string
  description?: string
  table: string
  select?: string
  columns: Column<any>[]
  fields: FieldDef[]
  permission: string | string[]           // write permission
  orgScoped?: boolean                      // add organisation_id on insert (default true)
  orderBy?: { column: string; ascending?: boolean }
  filter?: (q: any) => any
  remove?: 'delete' | { column: string; value: unknown }   // hard delete or soft-delete update
  defaults?: () => Record<string, unknown>
  transform?: (values: Record<string, any>) => Record<string, any>
  queryKey?: unknown[]
  headerActions?: ReactNode
  rowActions?: (row: any) => ReactNode
  embedded?: boolean                       // render without page header
  createLabel?: string
  exportName?: string
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function buildSchema(fields: FieldDef[]) {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const f of fields) {
    let s: z.ZodTypeAny
    switch (f.type) {
      case 'number': {
        let n = z.coerce.number({ error: `${f.label} must be a number` })
        if (f.min !== undefined) n = n.min(f.min, `${f.label} must be at least ${f.min}`)
        if (f.max !== undefined) n = n.max(f.max, `${f.label} must be at most ${f.max}`)
        // Empty must be checked before coercion: z.coerce.number('') is 0, which silently turned blank optional fields into 0.
        s = f.required ? n : z.union([z.literal('').transform(() => null), z.null(), n]).optional()
        break
      }
      case 'switch': s = z.boolean().default(false); break
      case 'weekdays': s = z.array(z.number()).default([]); break
      case 'tags': s = z.array(z.string()).default([]); break
      case 'email': s = f.required ? z.string().trim().email('Enter a valid email') : z.string().trim().email('Enter a valid email').or(z.literal('')).optional(); break
      default:
        s = f.required ? z.string({ error: `${f.label} is required` }).trim().min(1, `${f.label} is required`) : z.string().optional().nullable()
    }
    shape[f.name] = s
  }
  return z.object(shape)
}

export function LookupSelect({ def, value, onChange, invalid }: { def: FieldDef; value: any; onChange: (v: any) => void; invalid?: boolean }) {
  const lk = def.lookup!
  const q = useLookup<any>(lk.table, `${lk.value ?? 'id'}, ${lk.label ?? 'name'}`, lk.order ?? lk.label ?? 'name', lk.filter)
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} aria-invalid={invalid}>
      <option value="">{q.isLoading ? 'Loading…' : def.required ? 'Select…' : '— None —'}</option>
      {(q.data ?? []).map((o: any) => <option key={o[lk.value ?? 'id']} value={o[lk.value ?? 'id']}>{o[lk.label ?? 'name']}</option>)}
    </Select>
  )
}

export function FormFields({ fields, control, register, errors, watch }: any) {
  const values = watch()
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.filter((f: FieldDef) => !f.showIf || f.showIf(values)).map((f: FieldDef) => {
        const err = errors[f.name]?.message as string | undefined
        const wide = f.wide || f.type === 'textarea' || f.type === 'weekdays'
        return (
          <Field key={f.name} label={f.type === 'switch' ? undefined : f.label} error={err} hint={f.hint} required={f.required} className={cn(wide && 'sm:col-span-2')}>
            {f.type === 'textarea' ? <Textarea {...register(f.name)} aria-invalid={!!err} />
              : f.type === 'select' ? (
                <Select {...register(f.name)} aria-invalid={!!err}>
                  {!f.required && <option value="">— None —</option>}
                  {f.required && <option value="">Select…</option>}
                  {f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              ) : f.type === 'switch' ? (
                <Controller control={control} name={f.name} render={({ field }) => (
                  <label className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
                    <span className="text-sm">{f.label}</span>
                    <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                  </label>
                )} />
              ) : f.type === 'lookup' ? (
                <Controller control={control} name={f.name} render={({ field }) => <LookupSelect def={f} value={field.value} onChange={field.onChange} invalid={!!err} />} />
              ) : f.type === 'employee' ? (
                <Controller control={control} name={f.name} render={({ field }) => <EmployeePicker value={field.value} onChange={field.onChange} allowClear={!f.required} />} />
              ) : f.type === 'weekdays' ? (
                <Controller control={control} name={f.name} render={({ field }) => (
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAYS.map((d, i) => {
                      const on = (field.value ?? []).includes(i)
                      return (
                        <button key={d} type="button" onClick={() => field.onChange(on ? field.value.filter((x: number) => x !== i) : [...(field.value ?? []), i].sort())}
                          className={cn('h-8 w-12 rounded-md border text-sm', on ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted hover:bg-raised')}>{d}</button>
                      )
                    })}
                  </div>
                )} />
              ) : f.type === 'tags' ? (
                <Controller control={control} name={f.name} render={({ field }) => (
                  <div className="flex flex-wrap gap-1.5">
                    {f.options!.map((o) => {
                      const on = (field.value ?? []).includes(o.value)
                      return (
                        <button key={o.value} type="button" onClick={() => field.onChange(on ? field.value.filter((x: string) => x !== o.value) : [...(field.value ?? []), o.value])}
                          className={cn('h-8 rounded-md border px-2.5 text-sm', on ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted hover:bg-raised')}>{o.label}</button>
                      )
                    })}
                  </div>
                )} />
              ) : (
                <Input type={f.type === 'datetime' ? 'datetime-local' : f.type} step={f.step ?? (f.type === 'number' ? 'any' : undefined)} {...register(f.name)} aria-invalid={!!err}
                  className={f.type === 'color' ? 'h-9 w-20 p-1' : undefined} />
              )}
          </Field>
        )
      })}
    </div>
  )
}

export function CrudDialog({ cfg, open, onOpenChange, editing }: { cfg: CrudConfig; open: boolean; onOpenChange: (o: boolean) => void; editing: any | null }) {
  const { orgId } = useMe()
  const schema = useMemo(() => buildSchema(cfg.fields), [cfg.fields])
  const initial = useMemo(() => {
    const base: Record<string, any> = {}
    for (const f of cfg.fields) {
      let v = editing ? editing[f.name] : (cfg.defaults?.()[f.name] ?? f.default)
      if (f.type === 'time' && typeof v === 'string') v = v.slice(0, 5)
      if (f.type === 'datetime' && typeof v === 'string') v = v.slice(0, 16)
      if (f.type === 'switch') v = !!v
      if (f.type === 'weekdays' || f.type === 'tags') v = v ?? []
      if (f.type === 'number' && v === undefined) v = ''
      base[f.name] = v ?? (f.type === 'switch' ? false : '')
    }
    return base
  }, [editing, cfg])
  const form = useForm({ resolver: zodResolver(schema), values: initial })
  const save = useAction(async (values: Record<string, any>) => {
    let payload: Record<string, any> = {}
    for (const f of cfg.fields) {
      let v = values[f.name]
      if (v === '' || v === undefined) v = null
      if (f.type === 'datetime' && v) v = new Date(v).toISOString()
      payload[f.name] = v
    }
    if (cfg.transform) payload = cfg.transform(payload)
    if (editing) return unwrap(db.from(cfg.table).update(payload).eq('id', editing.id).select('id'))
    if (cfg.orgScoped !== false) payload.organisation_id = orgId
    return unwrap(db.from(cfg.table).insert(payload).select('id'))
  }, { success: editing ? 'Changes saved' : 'Created', invalidate: [cfg.queryKey ?? ['crud', cfg.table], ['lookup', cfg.table]], onSuccess: () => onOpenChange(false) })

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={editing ? `Edit ${singular(cfg.title)}` : (cfg.createLabel ?? `New ${singular(cfg.title)}`)} size="lg"
      footer={<>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button loading={save.isPending} onClick={form.handleSubmit((v) => save.mutate(v as any))}>{editing ? 'Save changes' : 'Create'}</Button>
      </>}>
      <form onSubmit={form.handleSubmit((v) => save.mutate(v as any))}>
        <FormFields fields={cfg.fields} control={form.control} register={form.register} errors={form.formState.errors} watch={form.watch} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

export function CrudPage({ cfg }: { cfg: CrudConfig }) {
  const { can } = useAuth()
  const confirm = useConfirm()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<any | null>(null)
  const writable = can(cfg.permission)
  const key = cfg.queryKey ?? ['crud', cfg.table]

  const q = useQuery({
    queryKey: [...key, cfg.filter ? String(cfg.filter) : ''],
    queryFn: async () => {
      let query: any = db.from(cfg.table).select(cfg.select ?? '*').limit(2000)
      if (cfg.filter) query = cfg.filter(query)
      if (cfg.orderBy) query = query.order(cfg.orderBy.column, { ascending: cfg.orderBy.ascending ?? true })
      return unwrap<any[]>(query)
    },
  })

  const remove = useAction(async (row: any) => {
    if (cfg.remove && cfg.remove !== 'delete') return unwrap(db.from(cfg.table).update({ [cfg.remove.column]: cfg.remove.value }).eq('id', row.id).select('id'))
    return unwrap(db.from(cfg.table).delete().eq('id', row.id).select('id'))
  }, { success: cfg.remove && cfg.remove !== 'delete' ? 'Archived' : 'Deleted', invalidate: [key, ['lookup', cfg.table]] })

  const columns: Column<any>[] = [
    ...cfg.columns,
    ...(writable || cfg.rowActions ? [{
      key: '_actions', header: '', sortable: false, exportable: false, className: 'w-12 text-right',
      cell: (r: any) => (
        <div onClick={(e) => e.stopPropagation()} className="flex justify-end gap-1">
          {cfg.rowActions?.(r)}
          {writable && (
            <Menu trigger={<Button variant="ghost" size="icon-sm" aria-label="Row actions"><MoreHorizontal /></Button>}>
              <MenuItem onSelect={() => { setEditing(r); setOpen(true) }}><Pencil /> Edit</MenuItem>
              {cfg.remove !== undefined && (
                <MenuItem danger onSelect={async () => {
                  const soft = cfg.remove !== 'delete'
                  const ok = await confirm({ title: soft ? 'Archive this record?' : 'Delete this record?', description: soft ? 'It will be hidden from new selections but kept for history.' : 'This cannot be undone.', danger: true, confirmLabel: soft ? 'Archive' : 'Delete' })
                  if (ok.ok) remove.mutate(r)
                }}>{cfg.remove === 'delete' ? <Trash2 /> : <Archive />} {cfg.remove === 'delete' ? 'Delete' : 'Archive'}</MenuItem>
              )}
            </Menu>
          )}
        </div>
      ),
    } as Column<any>] : []),
  ]

  const createBtn = writable ? <Button onClick={() => { setEditing(null); setOpen(true) }}><Plus /> {cfg.createLabel ?? `New ${singular(cfg.title)}`}</Button> : null

  return (
    <div>
      {!cfg.embedded && <PageHeader title={cfg.title} description={cfg.description} actions={<>{cfg.headerActions}{createBtn}</>} />}
      <DataTable rows={q.data} columns={columns} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} exportName={cfg.exportName ?? cfg.title}
        toolbar={cfg.embedded ? <div className="ml-auto">{createBtn}</div> : undefined}
        emptyTitle={`No ${cfg.title.toLowerCase()} yet`} emptyDescription={writable ? 'Create the first one to get started.' : undefined} emptyAction={cfg.embedded ? undefined : createBtn}
        onRowClick={writable ? (r) => { setEditing(r); setOpen(true) } : undefined} />
      {writable && <CrudDialog cfg={cfg} open={open} onOpenChange={setOpen} editing={editing} />}
    </div>
  )
}
