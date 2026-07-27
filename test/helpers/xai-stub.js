/**
 * A WebSocket server standing in for api.x.ai.
 *
 * Records the URL and headers it was dialled with and every frame it receives,
 * so a test can assert on what the proxy actually sent upstream rather than on
 * what it meant to.
 */

import { createServer } from 'node:http';
import { once } from 'node:events';

import { WebSocketServer } from 'ws';

export async function startXaiStub() {
  const http = createServer();
  const wss = new WebSocketServer({ server: http });

  const state = {
    /** Every frame the proxy sent upstream, parsed, in order. */
    received: [],
    /** The request the proxy opened the socket with. */
    url: null,
    headers: null,
    socket: null,
  };

  /** Resolves once `received` has at least `n` frames. */
  let waiters = [];
  const check = () => {
    waiters = waiters.filter((w) => {
      if (state.received.length >= w.n) {
        w.resolve(state.received);
        return false;
      }
      return true;
    });
  };

  wss.on('connection', (ws, req) => {
    state.url = req.url;
    state.headers = req.headers;
    state.socket = ws;
    ws.on('message', (data) => {
      try {
        state.received.push(JSON.parse(data.toString()));
      } catch {
        state.received.push({ type: '<unparseable>', raw: data });
      }
      check();
    });
  });

  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  const { port } = http.address();

  return {
    ...state,
    url: () => state.url,
    headers: () => state.headers,
    received: () => state.received,
    /** `ws://…` — what to hand loadConfig() as XAI_REALTIME_URL. */
    address: `ws://127.0.0.1:${port}`,
    /** A frame from xAI down to the browser. */
    send: (event) => state.socket.send(JSON.stringify(event)),
    waitFor(n, ms = 2000) {
      if (state.received.length >= n) return Promise.resolve(state.received);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`only ${state.received.length} of ${n} frames arrived`)),
          ms,
        );
        waiters.push({ n, resolve: (v) => { clearTimeout(timer); resolve(v); } });
      });
    },
    async close() {
      for (const client of wss.clients) client.terminate();
      wss.close();
      http.close();
      await once(http, 'close');
    },
  };
}
