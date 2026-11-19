import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App'
import './index.css'

// After a new deploy, an open tab still asks for the old build's lazy-loaded page chunks, which no longer exist.
// Vite fires vite:preloadError for that: reload once to pick up the new build instead of showing a broken page.
window.addEventListener('vite:preloadError', (e) => {
  const key = 'apex-chunk-reload'
  const last = Number(sessionStorage.getItem(key) ?? 0)
  if (Date.now() - last > 10_000) {
    e.preventDefault()
    sessionStorage.setItem(key, String(Date.now()))
    window.location.reload()
  }
})

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
