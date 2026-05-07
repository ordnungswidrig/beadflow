#!/usr/bin/env node
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('\n  beadflow: frontend not built. Run "npm run build" in the beadflow package first.\n');
  process.exit(1);
}

const PORT = parseInt(process.env.PORT || '7777', 10);

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff':  'font/woff',
};


// SSE clients waiting for reload notifications
const sseClients = new Set();

function notifyClients() {
  for (const res of sseClients) {
    res.write('event: reload\ndata: {}\n\n');
  }
}

// Watch .beads/issues.jsonl for changes
function watchBeads() {
  const beadsDir = path.join(process.cwd(), '.beads');
  const watchFile = path.join(beadsDir, 'issues.jsonl');
  if (!fs.existsSync(watchFile)) return;

  let debounce = null;
  fs.watch(watchFile, () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      console.log('[beadflow] beads changed — notifying clients');
      notifyClients();
    }, 300);
  });
  console.log('[beadflow] watching .beads/issues.jsonl for changes');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // SSE endpoint for live reload
  if (pathname === '/_events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(':\n\n'); // initial comment to open stream
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (pathname === '/project.json') {
    const cwd = process.cwd();
    let name = '';
    // 1. bd config project.name
    if (!name) {
      const r = spawnSync('bd', ['config', 'get', 'project.name'], { cwd, encoding: 'utf8' });
      const v = (r.stdout || '').trim();
      if (v && !v.includes('not set')) name = v;
    }
    // 2. git remote name (last path segment, strip .git)
    if (!name) {
      const r = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8' });
      const url = (r.stdout || '').trim();
      if (url) name = url.split('/').pop().replace(/\.git$/, '');
    }
    // 3. directory name
    if (!name) name = path.basename(cwd);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ name }));
    return;
  }

  // Serve beads.json by streaming bd export and wrapping JSONL into a JSON array
  if (pathname === '/beads.json') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    const bd = spawn('bd', ['export', '--no-memories'], { cwd: process.cwd() });
    let buf = '';
    let first = true;
    res.write('[');
    bd.stdout.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop(); // keep incomplete last line
      for (const line of lines) {
        if (!line.trim()) continue;
        res.write((first ? '' : ',') + line);
        first = false;
      }
    });
    bd.stdout.on('end', () => {
      if (buf.trim()) res.write((first ? '' : ',') + buf);
      res.end(']');
    });
    bd.on('error', (err) => {
      console.error('[beadflow] bd export failed:', err.message);
      res.end(']');
    });
    return;
  }

  // Serve static files from dist/
  let filePath = path.join(DIST, pathname === '/' ? 'index.html' : pathname);

  // SPA fallback — serve index.html for unknown paths
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, 'index.html');
  }

  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  beadflow  →  ${url}\n`);
  watchBeads();
});
