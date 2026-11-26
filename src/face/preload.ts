import { useEffect } from 'react'
import { getFaceProvider } from './index'

/** Load the face models in the background once the app is idle, so the first clock-in scan starts straight away. */
export function usePreloadFace(enabled: boolean, providerId?: string) {
  useEffect(() => {
    if (!enabled) return
    const run = () => { try { getFaceProvider(providerId).load().catch(() => undefined) } catch { /* unknown provider: the scan will report it */ } }
    const w = window as any
    const id = w.requestIdleCallback ? w.requestIdleCallback(run, { timeout: 4000 }) : setTimeout(run, 1500)
    return () => (w.cancelIdleCallback ? w.cancelIdleCallback(id) : clearTimeout(id))
  }, [enabled, providerId])
}
