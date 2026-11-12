// Copies only the face models the app uses from @vladmandic/human into public/models.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
const src = join('node_modules', '@vladmandic', 'human', 'models')
const dst = join('public', 'models')
if (!existsSync(src)) { console.log('[face-models] @vladmandic/human not installed yet; skipping'); process.exit(0) }
mkdirSync(dst, { recursive: true })
const models = ['blazeface', 'facemesh', 'iris', 'faceres', 'antispoof', 'liveness']
for (const m of models) for (const ext of ['json', 'bin']) cpSync(join(src, `${m}.${ext}`), join(dst, `${m}.${ext}`))
console.log(`[face-models] copied ${models.length} models to public/models`)
