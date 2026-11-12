import { useRef, useState } from 'react'
import { Paperclip, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const MAX = 10 * 1024 * 1024

export function FileDrop({ files, onChange, accept = 'image/*,application/pdf', multiple = true, label = 'Attach files' }: {
  files: File[]; onChange: (f: File[]) => void; accept?: string; multiple?: boolean; label?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [err, setErr] = useState<string | null>(null)
  const add = (list: FileList | null) => {
    if (!list) return
    const arr = Array.from(list)
    const tooBig = arr.find((f) => f.size > MAX)
    if (tooBig) { setErr(`${tooBig.name} is larger than 10 MB`); return }
    setErr(null)
    onChange(multiple ? [...files, ...arr] : arr.slice(0, 1))
  }
  return (
    <div>
      <button type="button" onClick={() => ref.current?.click()}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files) }}
        className={cn('flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-raised px-4 py-5 text-sm text-muted hover:border-primary hover:text-primary')}>
        <Paperclip className="h-4 w-4" /> {label} <span className="text-xs text-subtle">(PDF or image, max 10 MB)</span>
      </button>
      <input ref={ref} type="file" hidden accept={accept} multiple={multiple} onChange={(e) => { add(e.target.files); e.target.value = '' }} />
      {err && <p className="mt-1 text-xs text-danger">{err}</p>}
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li key={i} className="flex items-center justify-between rounded-md border border-line px-2.5 py-1.5 text-sm">
              <span className="truncate">{f.name} <span className="text-xs text-subtle">{Math.round(f.size / 1024)} KB</span></span>
              <button type="button" onClick={() => onChange(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} className="text-muted hover:text-danger"><X className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
