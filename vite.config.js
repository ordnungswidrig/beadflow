import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawnSync } from 'child_process'

function parseSession(sessionId, cwd) {
  const projectKey = cwd.replace(/\//g, '-').replace(/^-/, '');
  const candidates = [
    path.join(os.homedir(), '.claude', 'projects', projectKey, `${sessionId}.jsonl`),
    path.join(os.homedir(), '.claude', 'projects', `-${projectKey}`, `${sessionId}.jsonl`),
  ];
  let file = candidates.find((f) => fs.existsSync(f));
  if (!file) return null;
  const MAX_CHARS = 8000;
  const msgs = [];
  let total = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (!['user', 'assistant'].includes(d.type)) continue;
    const content = d.message?.content ?? '';
    let text = typeof content === 'string' ? content
      : Array.isArray(content) ? content.filter(c => c.type === 'text').map(c => c.text).join(' ')
      : '';
    text = text.replace(/<[^>]+>/g, '').trim();
    if (!text) continue;
    if (total + text.length > MAX_CHARS) {
      text = text.slice(0, MAX_CHARS - total) + '…';
      msgs.push({ role: d.type, text, ts: d.timestamp });
      break;
    }
    total += text.length;
    msgs.push({ role: d.type, text, ts: d.timestamp });
  }
  return msgs;
}

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

      server.middlewares.use('/session/', (req, res, next) => {
        const sessionId = req.url?.replace(/^\//, '').split('?')[0];
        if (!sessionId) return next();
        const msgs = parseSession(sessionId, process.cwd());
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(msgs ?? []));
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
