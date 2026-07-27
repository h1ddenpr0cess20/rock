/**
 * The socket proxy: browser ↔ here ↔ api.x.ai.
 *
 * Every frame of audio passes through this process, which is a deliberate cost.
 * The alternative — minting an ephemeral token and letting the page dial xAI
 * directly — can't work for this app: `/v1/realtime/client_secrets` takes no
 * `session` field, so the persona, the tool list and the MCP credentials would
 * all have to be sent from the browser, where they are readable and editable.
 * Proxying keeps them here. It also sidesteps the token's five-minute TTL,
 * which a conversation routinely outlives.
 *
 * What the page is allowed to say upstream is an allowlist, not a filter: audio
 * frames, a typed message, a request to respond, a cancel. A `session.update`
 * from the browser is dropped on the floor, as is a per-response `instructions`
 * override — those are the two ways a page could rewrite who Rock is.
 */

import { WebSocketServer, WebSocket } from 'ws';

import { buildTools, sessionConfig } from './persona.js';

/** Frames the page may send upstream. Anything else is dropped. */
const ALLOWED = new Set([
  'input_audio_buffer.append',
  'input_audio_buffer.commit',
  'input_audio_buffer.clear',
  'conversation.item.create',
  'response.create',
  'response.cancel',
]);

/* A base64 second of 24 kHz mono PCM16 is ~64 kB; this is room for a long turn
   of typed text or a jumbo audio chunk, and a ceiling on a page gone wrong. */
const MAX_FRAME = 1 << 20;

/** ws will only send close codes in these ranges — 1006 and friends throw. */
function safeCloseCode(code) {
  return code === 1000 || (code >= 3000 && code <= 4999) ? code : 1011;
}

/**
 * Vet one client frame. Returns the object to forward, or null to drop it.
 *
 * Rewrites rather than rejects where a rewrite is obvious: a `response.create`
 * carrying `instructions` is almost certainly a well-meaning caller rather than
 * an attack, and it works fine once the override is stripped.
 */
export function sanitize(event) {
  if (!event || typeof event !== 'object' || !ALLOWED.has(event.type)) return null;

  if (event.type === 'response.create') {
    // Per-response `instructions` replace the session prompt for that turn,
    // which is a persona override with extra steps.
    const { instructions, ...response } = event.response ?? {};
    return { ...event, response };
  }

  if (event.type === 'conversation.item.create') {
    // Only the person's own turns. `force_message` would put words in Rock's
    // mouth, and there are no client-side function tools to answer for.
    const item = event.item;
    if (!item || item.type !== 'message' || item.role !== 'user') return null;
  }

  return event;
}

/**
 * @param {object} config  from loadConfig()
 * @returns {{ handleUpgrade: (req, socket, head) => void, close: () => void }}
 */
export function createRealtimeProxy(config) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (client, req) => {
    const params = new URL(req.url, 'http://localhost').searchParams;
    // The page proposes, the proxy disposes: anything off the published lists
    // falls back to the configured default rather than travelling upstream to
    // come back as an opaque 400 halfway through the handshake.
    const voice = config.voices.includes(params.get('voice'))
      ? params.get('voice')
      : config.defaultVoice;
    const model = config.models.includes(params.get('model'))
      ? params.get('model')
      : config.defaultModel;

    /** Errors the page should see: the HUD renders `message` verbatim. */
    const tell = (message) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'error', error: { message } }));
      }
    };

    if (!config.apiKey) {
      tell('XAI_API_KEY is not set — the proxy has nothing to dial with.');
      return client.close(4001, 'no api key');
    }

    const url = `${config.realtimeUrl}?model=${encodeURIComponent(model)}`;
    const upstream = new WebSocket(url, {
      headers: { authorization: `Bearer ${config.apiKey}` },
    });

    /* Frames the page sends before xAI answers the handshake. The mic can open
       before the upstream socket does, and dropping that first half-second
       makes Rock miss the start of the first thing anyone says to him. */
    let pending = [];

    upstream.on('open', () => {
      // Persona, tools and audio format, before anything the page queued —
      // the first frame upstream is always ours.
      upstream.send(JSON.stringify({
        type: 'session.update',
        session: sessionConfig({ voice, tools: buildTools(config.tools) }),
      }));
      for (const frame of pending) upstream.send(frame);
      pending = [];
      // The page can't see the query it ended up with, only the one it asked
      // for, so the settled pair comes back down the socket.
      client.send(JSON.stringify({ type: 'proxy.ready', model, voice }));
    });

    upstream.on('message', (data, isBinary) => {
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
    });

    upstream.on('error', (err) => {
      tell(`the call to xAI failed — ${err.message}`);
    });

    upstream.on('close', (code, reason) => {
      if (client.readyState === WebSocket.OPEN) {
        client.close(safeCloseCode(code), reason?.toString().slice(0, 120) || '');
      }
    });

    client.on('message', (data, isBinary) => {
      // Binary transport is off in sessionConfig(), so a binary frame from the
      // page is a bug on the page. Audio arrives base64 inside JSON.
      if (isBinary || data.length > MAX_FRAME) return;

      let event;
      try {
        event = sanitize(JSON.parse(data.toString()));
      } catch {
        return; // a frame we can't parse is a frame we don't forward
      }
      if (!event) return;

      const frame = JSON.stringify(event);
      if (upstream.readyState === WebSocket.OPEN) upstream.send(frame);
      else if (upstream.readyState === WebSocket.CONNECTING) pending.push(frame);
    });

    client.on('close', () => {
      pending = [];
      if (upstream.readyState === WebSocket.OPEN) upstream.close(1000);
      else upstream.terminate(); // still connecting: there is no close frame to wait for
    });

    client.on('error', () => upstream.terminate());
  });

  return {
    /** Mounted on the http server's 'upgrade' event by app.js and vite.config.js. */
    handleUpgrade(req, socket, head) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    },
    close: () => wss.close(),
  };
}
