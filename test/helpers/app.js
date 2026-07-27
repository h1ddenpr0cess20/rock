/**
 * A running app plus a browser-side socket to it, torn down together.
 *
 * The proxy is only meaningfully testable end to end — what matters is what
 * comes out the far side — so these tests boot the real server against the
 * stub rather than reaching into createRealtimeProxy().
 */

import { once } from 'node:events';

import { WebSocket } from 'ws';

import { createApp } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config.js';

/**
 * @param {object} env  overrides merged over a minimal working environment
 * @param {string} env.XAI_REALTIME_URL  usually the stub's address
 */
export async function startApp(env = {}) {
  const config = loadConfig({ XAI_API_KEY: 'xai-test-key', ...env });
  const server = createApp(config, { root: '/nonexistent' });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;

  const sockets = [];

  return {
    config,
    origin,

    get: (path) => fetch(`${origin}${path}`),

    /** The page's half of the call. Resolves once the socket is open. */
    async openSocket(query = '') {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/realtime${query}`);
      sockets.push(ws);

      /** Frames the client received, in order. */
      const frames = [];
      ws.on('message', (data) => {
        try {
          frames.push(JSON.parse(data.toString()));
        } catch {
          /* the client ignores unparseable frames too */
        }
      });

      const closed = once(ws, 'close');
      await once(ws, 'open');

      return {
        ws,
        frames,
        closed,
        send: (event) => ws.send(JSON.stringify(event)),
        /** Resolves with the first frame of `type`, or rejects on timeout. */
        waitFor(type, ms = 2000) {
          const found = frames.find((f) => f.type === type);
          if (found) return Promise.resolve(found);
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              ws.off('message', onMessage);
              reject(new Error(`no ${type} frame arrived`));
            }, ms);
            const onMessage = (data) => {
              let event;
              try {
                event = JSON.parse(data.toString());
              } catch {
                return;
              }
              if (event.type !== type) return;
              clearTimeout(timer);
              ws.off('message', onMessage);
              resolve(event);
            };
            ws.on('message', onMessage);
          });
        },
      };
    },

    async close() {
      for (const ws of sockets) ws.terminate();
      server.close();
      await once(server, 'close');
    },
  };
}

/** Lets queued I/O settle — for asserting that something did *not* happen. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
