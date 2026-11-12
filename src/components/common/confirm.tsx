import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Field, Textarea } from '@/components/ui/input'

type Opts = { title: string; description?: string; confirmLabel?: string; danger?: boolean; requireReason?: boolean; reasonLabel?: string }
type Ctx = (o: Opts) => Promise<{ ok: boolean; reason?: string }>
const C = createContext<Ctx | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(Opts & { resolve: (r: { ok: boolean; reason?: string }) => void }) | null>(null)
  const [reason, setReason] = useState('')
  const confirm = useCallback<Ctx>((o) => new Promise((resolve) => { setReason(''); setState({ ...o, resolve }) }), [])
  const close = (ok: boolean) => { state?.resolve({ ok, reason: reason.trim() || undefined }); setState(null) }
  return (
    <C.Provider value={confirm}>
      {children}
      <Dialog open={!!state} onOpenChange={(o) => !o && close(false)} title={state?.title ?? ''} description={state?.description} size="sm"
        footer={<>
          <Button variant="secondary" onClick={() => close(false)}>Cancel</Button>
          <Button variant={state?.danger ? 'danger' : 'primary'} disabled={state?.requireReason && !reason.trim()} onClick={() => close(true)}>{state?.confirmLabel ?? 'Confirm'}</Button>
        </>}>
        {state?.requireReason ? (
          <Field label={state.reasonLabel ?? 'Reason'} required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </Field>
        ) : <p className="text-sm text-muted">This action is recorded in the audit log.</p>}
      </Dialog>
    </C.Provider>
  )
}
export function useConfirm() {
  const c = useContext(C)
  if (!c) throw new Error('useConfirm outside provider')
  return c
}
