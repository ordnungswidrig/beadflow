import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { exportBeads } from './lib/exportBeads.js'

function beadsDevPlugin() {
  const sseClients = new Set();

  function watchBeads(server) {
    const watchFile = path.resolve('.beads/issues.jsonl');
    if (!fs.existsSync(watchFile)) return;
    let debounce = null;
    fs.watch(watchFile, () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        console.log('[beads] changed — notifying clients');
        for (const res of sseClients) res.write('event: reload\ndata: {}\n\n');
        // Also trigger Vite HMR reload
        server.ws.send({ type: 'full-reload' });
      }, 300);
    });
  }

  return {
    name: 'beads-dev',
    configureServer(server) {
      watchBeads(server);

      server.middlewares.use('/_events', (req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        res.write(':\n\n');
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
      });

      server.middlewares.use('/beads.json', (_req, res) => {
        const data = exportBeads();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(data);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), beadsDevPlugin()],
  server: {
    allowedHosts: ['bf.l.c6e.de'],
  },
})
