/**
 * Static hosting for the built client — production only.
 *
 * In development Vite serves the page itself, with its own transform pipeline
 * and HMR, and this file is never loaded.
 */

import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function createStaticMiddleware(root) {
  const base = root.endsWith(sep) ? root : root + sep;

  async function read(path) {
    // `my icon.png` arrives as `my%20icon.png`; normalize() below runs on the result.
    let name;
    try {
      name = decodeURIComponent(path);
    } catch {
      return null;
    }

    const file = join(base, normalize(name));
    // normalize() collapses any ../ before it can escape the build directory.
    if (!file.startsWith(base)) return null;
    try {
      if (!(await stat(file)).isFile()) return null;
      return { file, body: await readFile(file) };
    } catch {
      return null;
    }
  }

  return async function serveStatic(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const path = req.url.split('?')[0];
    // Vite fingerprints everything under /assets/, so those are safe to pin.
    const immutable = path.startsWith('/assets/');
    const found = (await read(path)) ?? (extname(path) ? null : await read('/index.html'));

    if (!found) return next();

    res.writeHead(200, {
      'content-type': MIME[extname(found.file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'content-length': found.body.length,
    });
    res.end(req.method === 'HEAD' ? undefined : found.body);
  };
}
