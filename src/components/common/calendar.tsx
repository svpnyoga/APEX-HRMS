import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, isToday, startOfMonth, startOfWeek } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function MonthNav({ month, onChange }: { month: Date; onChange: (d: Date) => void }) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="secondary" size="icon-sm" onClick={() => onChange(addMonths(month, -1))} aria-label="Previous month"><ChevronLeft /></Button>
      <span className="w-32 text-center text-sm font-medium">{format(month, 'MMMM yyyy')}</span>
      <Button variant="secondary" size="icon-sm" onClick={() => onChange(addMonths(month, 1))} aria-label="Next month"><ChevronRight /></Button>
    </div>
  )
}

/** Month grid; renderDay returns the content of each cell. */
export function MonthCalendar({ month, renderDay, className }: { month: Date; renderDay: (d: Date) => ReactNode; className?: string }) {
  const days = eachDayOfInterval({ start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }) })
  return (
    <div className={cn('overflow-hidden rounded-xl border border-line bg-surface', className)}>
      <div className="grid grid-cols-7 border-b border-line bg-raised text-center text-xs font-medium text-muted">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="py-2">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => (
          <div key={d.toISOString()} className={cn('min-h-[86px] border-b border-r border-line p-1.5 text-xs [&:nth-child(7n)]:border-r-0', !isSameMonth(d, month) && 'bg-raised/60 text-subtle')}>
            <div className={cn('mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full tnum', isToday(d) && 'bg-primary font-semibold text-primary-fg')}>{format(d, 'd')}</div>
            {isSameMonth(d, month) && renderDay(d)}
          </div>
        ))}
      </div>
    </div>
  )
}
