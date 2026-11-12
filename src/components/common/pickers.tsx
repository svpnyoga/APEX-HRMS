import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import * as P from '@radix-ui/react-popover'
import { useDirectory } from '@/hooks/data'
import { Avatar } from '@/components/ui/misc'
import { cn } from '@/lib/utils'

export function EmployeePicker({ value, onChange, placeholder = 'Select employee', allowClear, filter, className, disabled }: {
  value?: string | null; onChange: (id: string | null) => void; placeholder?: string; allowClear?: boolean
  filter?: (e: ReturnType<typeof useDirectory>['data'] extends (infer R)[] | undefined ? R : never) => boolean; className?: string; disabled?: boolean
}) {
  const { data = [] } = useDirectory()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const list = useMemo(() => data.filter((e) => (!filter || filter(e as any)) &&
    (`${e.full_name} ${e.employee_code} ${e.department_name ?? ''}`).toLowerCase().includes(q.toLowerCase())).slice(0, 60), [data, q, filter])
  const sel = data.find((e) => e.id === value)
  return (
    <P.Root open={open} onOpenChange={setOpen}>
      <P.Trigger asChild disabled={disabled}>
        <button type="button" className={cn('flex h-9 w-full items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 text-left text-sm disabled:opacity-60', className)}>
          {sel ? <span className="flex min-w-0 items-center gap-2"><Avatar name={sel.full_name} src={sel.photo_url} size={20} /><span className="truncate">{sel.full_name}</span><span className="text-xs text-subtle">{sel.employee_code}</span></span>
            : <span className="text-subtle">{placeholder}</span>}
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-subtle" />
        </button>
      </P.Trigger>
      <P.Portal>
        <P.Content align="start" sideOffset={4} className="z-[60] w-[var(--radix-popover-trigger-width)] min-w-[260px] rounded-lg border border-line bg-surface p-1 shadow-pop">
          <div className="relative mb-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or code"
              className="h-8 w-full rounded-md bg-raised pl-8 pr-2 text-sm outline-none" />
          </div>
          <div className="max-h-64 overflow-y-auto scrollbar-thin">
            {allowClear && value && (
              <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-sm text-muted hover:bg-raised" onClick={() => { onChange(null); setOpen(false) }}>Clear selection</button>
            )}
            {list.map((e) => (
              <button type="button" key={e.id} onClick={() => { onChange(e.id); setOpen(false) }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-raised">
                <Avatar name={e.full_name} src={e.photo_url} size={24} />
                <span className="min-w-0 flex-1"><span className="block truncate">{e.full_name}</span><span className="block truncate text-xs text-muted">{e.designation_name ?? '—'} · {e.employee_code}</span></span>
                {e.id === value && <Check className="h-4 w-4 text-primary" />}
              </button>
            ))}
            {list.length === 0 && <p className="px-2 py-4 text-center text-sm text-muted">No employees found</p>}
          </div>
        </P.Content>
      </P.Portal>
    </P.Root>
  )
}

export function EmployeeCell({ name, code, photo, sub }: { name?: string | null; code?: string | null; photo?: string | null; sub?: string | null }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar name={name} src={photo} size={28} />
      <span className="min-w-0">
        <span className="block truncate font-medium">{name ?? '—'}</span>
        <span className="block truncate text-xs text-muted">{sub ?? code ?? ''}</span>
      </span>
    </span>
  )
}
