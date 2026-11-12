import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, FileSpreadsheet, FileText, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Menu, MenuItem } from '@/components/ui/menu'
import { cn } from '@/lib/utils'
import { exportExcel, exportPdf, type ExportColumn } from '@/lib/export'
import { EmptyState, ErrorState, LoadingRows } from './page'
import { useAuth } from '@/app/auth'

export type Column<T> = {
  key: string
  header: string
  cell?: (row: T) => ReactNode
  value?: (row: T) => string | number | null | undefined   // used for sort, search and export
  sortable?: boolean
  className?: string
  hideOnMobile?: boolean
  exportable?: boolean
}

export function DataTable<T extends Record<string, any>>({
  rows, columns, loading, error, onRetry, searchable = true, searchPlaceholder = 'Search', pageSize = 25, toolbar, onRowClick,
  emptyTitle = 'Nothing here yet', emptyDescription, emptyAction, exportName, selectable, bulkActions, rowKey = 'id', initialSort, dense,
}: {
  rows?: T[]; columns: Column<T>[]; loading?: boolean; error?: unknown; onRetry?: () => void; searchable?: boolean; searchPlaceholder?: string
  pageSize?: number; toolbar?: ReactNode; onRowClick?: (row: T) => void; emptyTitle?: string; emptyDescription?: string; emptyAction?: ReactNode
  exportName?: string; selectable?: boolean; bulkActions?: (selected: T[], clear: () => void) => ReactNode; rowKey?: string
  initialSort?: { key: string; dir: 'asc' | 'desc' }; dense?: boolean
}) {
  const { can } = useAuth()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState(initialSort)
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const val = (c: Column<T>, r: T) => (c.value ? c.value(r) : r[c.key])

  const filtered = useMemo(() => {
    let out = rows ?? []
    if (q.trim()) {
      const needle = q.toLowerCase()
      out = out.filter((r) => columns.some((c) => String(val(c, r) ?? '').toLowerCase().includes(needle)))
    }
    if (sort) {
      const c = columns.find((x) => x.key === sort.key)
      if (c) {
        out = [...out].sort((a, b) => {
          const va = val(c, a), vb = val(c, b)
          if (va == null) return 1
          if (vb == null) return -1
          const r = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true })
          return sort.dir === 'asc' ? r : -r
        })
      }
    }
    return out
  }, [rows, q, sort, columns])

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = filtered.slice(page * pageSize, page * pageSize + pageSize)
  const selectedRows = (rows ?? []).filter((r) => selected.has(String(r[rowKey])))

  const exportCols: ExportColumn[] = columns.filter((c) => c.exportable !== false && c.key !== '_actions')
    .map((c) => ({ key: c.key, header: c.header, format: (r: any) => (val(c, r) as any) ?? '' }))

  const toggleAll = () => setSelected(selected.size === current.length ? new Set() : new Set(current.map((r) => String(r[rowKey]))))

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      {(searchable || toolbar || exportName) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          {searchable && (
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
              <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} placeholder={searchPlaceholder} className="pl-8" aria-label="Search table" />
            </div>
          )}
          <div className="flex flex-1 flex-wrap items-center gap-2">{toolbar}</div>
          {selectable && selectedRows.length > 0 && bulkActions && (
            <div className="flex items-center gap-2 rounded-md bg-primary-soft px-2 py-1 text-sm text-primary">
              {selectedRows.length} selected {bulkActions(selectedRows, () => setSelected(new Set()))}
            </div>
          )}
          {exportName && can('reports.export') && (
            <Menu trigger={<Button variant="secondary" size="sm"><Download /> Export</Button>}>
              <MenuItem onSelect={() => exportExcel(exportName, exportCols, filtered)}><FileSpreadsheet /> Excel (.xlsx)</MenuItem>
              <MenuItem onSelect={() => exportPdf(exportName, exportCols, filtered)}><FileText /> PDF</MenuItem>
            </Menu>
          )}
        </div>
      )}
      {loading ? <LoadingRows /> : error ? <ErrorState error={error} onRetry={onRetry} /> : filtered.length === 0 ? (
        <EmptyState title={q ? 'No matches' : emptyTitle} description={q ? 'Try a different search.' : emptyDescription} action={q ? undefined : emptyAction} />
      ) : (
        <>
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-raised text-left text-xs font-medium text-muted">
                <tr>
                  {selectable && (
                    <th className="w-10 px-3 py-2.5"><input type="checkbox" aria-label="Select all" checked={selected.size > 0 && selected.size === current.length} onChange={toggleAll} /></th>
                  )}
                  {columns.map((c) => (
                    <th key={c.key} className={cn('whitespace-nowrap px-3 py-2.5 font-medium', c.hideOnMobile && 'hidden md:table-cell', c.className)}>
                      {c.sortable !== false && c.key !== '_actions' ? (
                        <button className="inline-flex items-center gap-1 hover:text-text" onClick={() => setSort(sort?.key === c.key ? { key: c.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'asc' })}>
                          {c.header}
                          {sort?.key === c.key && (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                        </button>
                      ) : c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {current.map((r, i) => (
                  <tr key={String(r[rowKey] ?? i)} onClick={onRowClick ? () => onRowClick(r) : undefined}
                    className={cn('transition-colors hover:bg-raised/70', onRowClick && 'cursor-pointer')}>
                    {selectable && (
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label="Select row" checked={selected.has(String(r[rowKey]))}
                          onChange={() => { const s = new Set(selected); const k = String(r[rowKey]); s.has(k) ? s.delete(k) : s.add(k); setSelected(s) }} />
                      </td>
                    )}
                    {columns.map((c) => (
                      <td key={c.key} className={cn('px-3 text-text', dense ? 'py-1.5' : 'py-2.5', c.hideOnMobile && 'hidden md:table-cell', c.className)}>
                        {c.cell ? c.cell(r) : (val(c, r) ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-line px-3 py-2 text-xs text-muted">
            <span className="tnum">{filtered.length === 0 ? 0 : page * pageSize + 1}–{Math.min(filtered.length, (page + 1) * pageSize)} of {filtered.length}</span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft /></Button>
              <span className="tnum px-1">{page + 1} / {pages}</span>
              <Button variant="ghost" size="icon-sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight /></Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
