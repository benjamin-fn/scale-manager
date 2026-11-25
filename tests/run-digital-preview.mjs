import { createServer } from '../frontend/node_modules/vite/dist/node/index.js'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../../scale-digital/frontend/', import.meta.url))
const server = await createServer({
  root,
  configFile: join(root, 'vite.config.ts'),
  server: { host: 'localhost', port: 5176, strictPort: true, proxy: { '/api': 'http://127.0.0.1:5084' } },
})
await server.listen()
server.printUrls()

