import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AlertTriangle, ChevronRight, Inbox, RefreshCw } from 'lucide-react'
import { findNavLabel } from '@/app/nav'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/misc'
import { cn, errorMessage } from '@/lib/utils'

export function PageHeader({ title, description, actions, crumbs }: { title: string; description?: ReactNode; actions?: ReactNode; crumbs?: { label: string; to?: string }[] }) {
  const loc = useLocation()
  const nav = findNavLabel(loc.pathname, loc.search)
  const trail = crumbs ?? (nav.module ? [{ label: nav.module }] : [])
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {trail.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-1 flex items-center gap-1 text-xs text-muted">
            <Link to="/" className="hover:text-text">Home</Link>
            {trail.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3" />
                {c.to ? <Link to={c.to} className="hover:text-text">{c.label}</Link> : <span>{c.label}</span>}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-[22px] font-semibold leading-tight text-text">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function EmptyState({ title, description, action, icon: Icon = Inbox, className }: { title: string; description?: string; action?: ReactNode; icon?: any; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="mb-3 rounded-full bg-raised p-3 text-subtle"><Icon className="h-6 w-6" /></div>
      <p className="font-medium text-text">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)} role="alert">
      <div className="mb-3 rounded-full bg-danger-soft p-3 text-danger"><AlertTriangle className="h-6 w-6" /></div>
      <p className="font-medium">This couldn't be loaded</p>
      <p className="mt-1 max-w-md text-sm text-muted">{errorMessage(error)}</p>
      {onRetry && <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}><RefreshCw /> Try again</Button>}
    </div>
  )
}

export function LoadingRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-5" aria-busy>
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className={cn('h-5', i % 3 === 0 ? 'w-3/4' : 'w-full')} />)}
    </div>
  )
}

/** Renders loading / error / empty / content for a TanStack query result. */
export function QueryView<T>({ q, empty, children, loading }: {
  q: { data?: T; isLoading: boolean; error: unknown; refetch: () => unknown }
  empty?: { when: (d: T) => boolean; title: string; description?: string; action?: ReactNode }
  children: (d: T) => ReactNode
  loading?: ReactNode
}) {
  if (q.isLoading) return <>{loading ?? <LoadingRows />}</>
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (q.data === undefined) return null
  if (empty && empty.when(q.data)) return <EmptyState title={empty.title} description={empty.description} action={empty.action} />
  return <>{children(q.data)}</>
}

/** Divided summary strip — one container, not a row of identical cards. */
export function StatStrip({ items, className }: { items: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'success' | 'warning' | 'danger' | 'primary'; to?: string }[]; className?: string }) {
  const toneCls = { default: 'text-text', success: 'text-success', warning: 'text-warning', danger: 'text-danger', primary: 'text-primary' }
  return (
    <div className={cn('grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-surface shadow-card sm:grid-cols-3', items.length >= 5 ? 'lg:grid-cols-5' : 'lg:grid-cols-4', items.length >= 6 && 'xl:grid-cols-6', className)}>
      {items.map((s, i) => {
        const inner = (
          <>
            <div className="text-[13px] text-muted">{s.label}</div>
            <div className={cn('figure mt-1 text-[28px] font-semibold leading-none', toneCls[s.tone ?? 'default'])}>{s.value}</div>
            {s.hint && <div className="mt-1.5 text-xs text-subtle">{s.hint}</div>}
          </>
        )
        const cls = 'block border-b border-r border-line px-5 py-4 -mb-px -mr-px'
        return s.to ? <Link key={i} to={s.to} className={cn(cls, 'transition-colors hover:bg-raised')}>{inner}</Link> : <div key={i} className={cls}>{inner}</div>
      })}
    </div>
  )
}
