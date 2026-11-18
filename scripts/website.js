// Serves website/ locally the way Cloudflare Pages does: clean URLs (/privacy -> privacy.html),
// 404.html for missing pages, and the response headers from _headers (so CSP problems show up here too).
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'website');
const port = Number(process.env.WEBSITE_PORT) || 4000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

// Only the "/*" block of _headers is used; it's the only one the site has.
async function siteHeaders() {
  const headers = {};
  const text = await readFile(path.join(root, '_headers'), 'utf8').catch(() => '');
  let inAll = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { inAll = line.trim() === '/*'; continue; }
    const at = line.indexOf(':');
    if (inAll && at > 0) headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return headers;
}

async function isFile(file) {
  return stat(file).then((s) => s.isFile(), () => false);
}

async function resolve(urlPath) {
  const clean = path.normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  const file = path.join(root, clean);
  if (!file.startsWith(root) || path.basename(file) === '_headers') return null;
  if (await isFile(file)) return file;
  if (await isFile(file + '.html')) return file + '.html';
  if (await isFile(path.join(file, 'index.html'))) return path.join(file, 'index.html');
  return null;
}

http.createServer(async (req, res) => {
  try {
    const headers = await siteHeaders();
    let file = await resolve(new URL(req.url, 'http://localhost').pathname);
    let status = 200;
    if (!file) { file = path.join(root, '404.html'); status = 404; }
    const body = await readFile(file);
    res.writeHead(status, { ...headers, 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Something went wrong serving the website. The error is in the terminal.');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`socialifer.com preview: http://localhost:${port}`);
});
