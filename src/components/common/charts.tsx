import type { ReactNode } from 'react'
import { Card, CardHeader } from '@/components/ui/misc'

// Validated categorical palette, ordered for adjacent contrast in light and dark.
export const SERIES = ['#3F3CBB', '#0E9F6E', '#D97706', '#DC2626', '#0891B2', '#7C3AED', '#64748B']
export const AXIS = { stroke: 'rgb(var(--subtle))', fontSize: 11, tickLine: false, axisLine: false } as const
export const GRID = { stroke: 'rgb(var(--line))', strokeDasharray: '3 3', vertical: false } as const
export const TOOLTIP = {
  contentStyle: { background: 'rgb(var(--surface))', border: '1px solid rgb(var(--line))', borderRadius: 8, fontSize: 12, color: 'rgb(var(--text))' },
  labelStyle: { color: 'rgb(var(--muted))' },
  cursor: { fill: 'rgb(var(--raised))' },
}

export function ChartCard({ title, description, actions, children, height = 260 }: { title: string; description?: string; actions?: ReactNode; children: ReactNode; height?: number }) {
  return (
    <Card>
      <CardHeader title={title} description={description} actions={actions} />
      <div className="px-3 py-4" style={{ height }}>{children}</div>
    </Card>
  )
}
