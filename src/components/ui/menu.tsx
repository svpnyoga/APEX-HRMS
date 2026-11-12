import * as DM from '@radix-ui/react-dropdown-menu'
import * as P from '@radix-ui/react-popover'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Menu({ trigger, children, align = 'end' }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'end' }) {
  return (
    <DM.Root>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content align={align} sideOffset={6} className="z-50 min-w-[190px] rounded-lg border border-line bg-surface p-1 shadow-pop animate-pop-in">
          {children}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  )
}
export function MenuItem({ children, onSelect, danger, disabled }: { children: ReactNode; onSelect?: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <DM.Item disabled={disabled} onSelect={onSelect}
      className={cn('flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-raised [&_svg]:size-4 [&_svg]:text-muted',
        danger ? 'text-danger [&_svg]:text-danger' : 'text-text')}>
      {children}
    </DM.Item>
  )
}
export const MenuSeparator = () => <DM.Separator className="my-1 h-px bg-line" />
export const MenuLabel = ({ children }: { children: ReactNode }) => <DM.Label className="px-2.5 py-1.5 text-xs text-muted">{children}</DM.Label>

export function Popover({ trigger, children, className, align = 'end' }: { trigger: ReactNode; children: ReactNode; className?: string; align?: 'start' | 'end' | 'center' }) {
  return (
    <P.Root>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content align={align} sideOffset={6} className={cn('z-50 rounded-xl border border-line bg-surface shadow-pop animate-pop-in focus:outline-none', className)}>
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  )
}
