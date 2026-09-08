// Tiny static server for the browser harness: serves the repo plus the
// Obsidian themes directory under /themes/ and the vault under /vault/.
import http from 'node:http';
import { createReadStream, existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const themesDir = process.env.IMARK_THEMES ?? '/Users/sloanwu/Documents/cybernotes/.obsidian/themes';
const vaultDir = process.env.IMARK_VAULT ?? path.dirname(path.dirname(themesDir));
const port = Number(process.env.PORT ?? 8765);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/dev/index.html';
    if (pathname === '/themes/index.json') {
      const list = existsSync(themesDir)
        ? readdirSync(themesDir, { withFileTypes: true })
            .filter((d) => d.isDirectory() && existsSync(path.join(themesDir, d.name, 'theme.css')))
            .map((d) => d.name)
        : [];
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify(list));
      return;
    }
    let file;
    if (pathname.startsWith('/themes/')) file = path.join(themesDir, pathname.slice('/themes/'.length));
    else if (pathname.startsWith('/vault/')) file = path.join(vaultDir, pathname.slice('/vault/'.length));
    else file = path.join(root, pathname);
    if (!existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found: ' + pathname);
      return;
    }
    res.writeHead(200, { 'content-type': types[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`iMark dev harness: http://localhost:${port}/  (themes: ${themesDir})`));
