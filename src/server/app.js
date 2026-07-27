/**
 * The production server, assembled but not started.
 *
 * Kept apart from index.js so importing it — from a test, or to embed Rock in
 * something larger — doesn't bind a port as a side effect.
 */

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { createApiMiddleware } from './api.js';
import { loadConfig } from './config.js';
import { createRealtimeProxy } from './realtime.js';
import { createStaticMiddleware } from './static.js';

const DIST = fileURLToPath(new URL('../../dist', import.meta.url));

/** Where the browser opens its half of the call. Shared with vite.config.js. */
export const REALTIME_PATH = '/realtime';

/** Runs middleware in order until one of them answers. */
export function chain(...middleware) {
  return (req, res) => {
    let i = 0;
    const next = () => {
      const fn = middleware[i++];
      if (!fn) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('not found');
      }
      Promise.resolve(fn(req, res, next)).catch((err) => {
        console.error(err);
        if (res.headersSent) return res.end();
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal error' }));
      });
    };
    next();
  };
}

export function createApp(config = loadConfig(), { root = DIST } = {}) {
  const server = createServer(chain(createApiMiddleware(config), createStaticMiddleware(root)));
  const realtime = createRealtimeProxy(config);

  server.on('upgrade', (req, socket, head) => {
    if (req.url.split('?')[0] !== REALTIME_PATH) return socket.destroy();
    realtime.handleUpgrade(req, socket, head);
  });

  return server;
}
