/**
 * The browser's half of the call: a WebSocket to our own proxy.
 *
 * Never to api.x.ai. The page holds no credential — the proxy attaches the key,
 * pins the persona and the tools, and forwards the rest. `voice` and `model`
 * ride the query string as a request; the proxy answers with what it actually
 * used in a `proxy.ready` frame.
 */

const PATH = '/realtime';

/* A dead socket that never opens would otherwise hang start() with the mic hot. */
const OPEN_TIMEOUT = 15_000;

function socketUrl({ voice, model }) {
  const url = new URL(PATH, location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (voice) url.searchParams.set('voice', voice);
  if (model) url.searchParams.set('model', model);
  return url;
}

/**
 * @param {object} options
 * @param {string} options.voice
 * @param {string} options.model
 * @param {(event: object) => void} options.onEvent  parsed server frames
 * @param {(reason: string | null) => void} options.onClose  dropped or hung up
 * @returns {Promise<{ open: boolean, send(event): boolean, close(): void }>}
 */
export function connect({ voice, model, onEvent, onClose }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(socketUrl({ voice, model }));
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.close();
      reject(new Error('the connection to the proxy timed out'));
    }, OPEN_TIMEOUT);

    ws.addEventListener('open', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        get open() {
          return ws.readyState === WebSocket.OPEN;
        },
        send(event) {
          if (ws.readyState !== WebSocket.OPEN) return false;
          ws.send(JSON.stringify(event));
          return true;
        },
        close() {
          onClose = () => {}; // our own teardown isn't a drop
          ws.close(1000);
        },
      });
    });

    ws.addEventListener('message', (e) => {
      // Output transport is JSON, so every frame down is text. A binary frame
      // is a session config we didn't ask for.
      if (typeof e.data !== 'string') return;
      try {
        onEvent(JSON.parse(e.data));
      } catch {
        /* a frame we can't parse is a frame we don't animate */
      }
    });

    ws.addEventListener('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // The error event carries nothing useful by design, so the message is
      // ours: this is overwhelmingly "the dev server isn't running".
      reject(new Error('could not reach the proxy — is it running? (npm run dev)'));
    });

    ws.addEventListener('close', (e) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        return reject(new Error(e.reason || 'the proxy closed the connection'));
      }
      // 1000 and 1005 (no status) are hangups; anything else dropped on us.
      onClose(e.code === 1000 || e.code === 1005 ? null : e.reason || 'the call dropped');
    });
  });
}
