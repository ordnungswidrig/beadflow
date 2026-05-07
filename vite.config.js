import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'

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
        const result = spawnSync('bd', ['export', '--no-memories'], { encoding: 'utf8' });
        const lines = (result.stdout || '').trim().split('\n').filter(Boolean);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end('[' + lines.join(',') + ']');
      });

      server.middlewares.use('/project.json', (_req, res) => {
        let name = '';
        // 1. bd config project.name
        if (!name) {
          const r = spawnSync('bd', ['config', 'get', 'project.name'], { encoding: 'utf8' });
          const v = (r.stdout || '').trim();
          if (v && !v.includes('not set')) name = v;
        }
        // 2. git remote name (last path segment, strip .git)
        if (!name) {
          const r = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' });
          const url = (r.stdout || '').trim();
          if (url) name = url.split('/').pop().replace(/\.git$/, '');
        }
        // 3. directory name (parent of .beads/)
        if (!name) name = path.basename(process.cwd());
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ name }));
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
