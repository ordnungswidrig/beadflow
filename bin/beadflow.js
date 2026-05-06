#!/usr/bin/env node
import http from 'http';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

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

function exportBeads() {
  try {
    const result = execSync('bd export', { cwd: process.cwd(), encoding: 'utf8' });
    const lines = result.trim().split('\n').filter(Boolean);
    const issues = lines.map((l) => JSON.parse(l));
    return JSON.stringify(issues);
  } catch (e) {
    console.error('[beadflow] bd export failed:', e.message);
    return '[]';
  }
}

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

  // Serve beads.json dynamically from bd export
  if (pathname === '/beads.json') {
    const data = exportBeads();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(data);
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
