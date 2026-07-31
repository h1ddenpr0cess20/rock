import { WebSocketServer, WebSocket } from 'ws';

import { buildTools, sessionConfig } from './persona.js';

const ALLOWED = new Set([
  'input_audio_buffer.append',
  'input_audio_buffer.commit',
  'input_audio_buffer.clear',
  'conversation.item.create',
  'response.create',
  'response.cancel',
]);

const MAX_FRAME = 1 << 20;

/**
 * The page's own frame, handled here and never forwarded: it carries the
 * memories held in browser storage, which the proxy folds into the session
 * instructions. The persona itself stays server-side and unreachable.
 */
export const MEMORY_EVENT = 'session.memory';

/**
 * The other frame the page keeps to itself: the turns of a conversation it is
 * picking up out of its own log. The proxy replays them upstream as real
 * conversation items — one per turn, a user message carrying `input_text` and
 * an assistant message carrying `output_text`, which is what the realtime API
 * takes for history — ahead of anything said in the new call.
 *
 * It arrives as turns rather than as items so the page never names a role: it
 * hands over what was said, and the shape going up is this file's to decide.
 */
export const HISTORY_EVENT = 'session.history';

/** How much of an earlier conversation the proxy will replay. */
const HISTORY_TURNS = 40;
const HISTORY_CHARS = 6000;

/**
 * What the page sent, cut back to turns this will actually replay. The content
 * is text the model reads, so it is capped here as well as in the page — the
 * page is not the only thing that can open this socket.
 */
export function priorTurns(turns) {
  const kept = (Array.isArray(turns) ? turns : [])
    .filter((turn) => (turn?.role === 'user' || turn?.role === 'assistant')
      && typeof turn.content === 'string'
      && turn.content.trim())
    .map((turn) => ({ role: turn.role, content: turn.content.trim().slice(0, HISTORY_CHARS) }))
    .slice(-HISTORY_TURNS);

  let total = kept.reduce((sum, turn) => sum + turn.content.length, 0);
  while (total > HISTORY_CHARS && kept.length > 1) {
    total -= kept.shift().content.length;
  }

  return kept;
}

/**
 * One replayed turn, as an item. Both roles carry `input_text`: xAI documents
 * history seeding with a user text message or an assistant text message, and
 * `input_text` as the content type for a text message either way. It follows
 * OpenAI's beta naming here, as it does for the text events `events.js` has to
 * handle two spellings of — `output_text` is the GA shape and not this one.
 *
 * Each of these is a billed event upstream, which is what keeps the replay
 * capped: a picked-up conversation costs its turns, once.
 */
export function historyItem({ role, content }) {
  return {
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role,
      status: 'completed',
      content: [{ type: 'input_text', text: content }],
    },
  };
}

function safeCloseCode(code) {
  return code === 1000 || (code >= 3000 && code <= 4999) ? code : 1011;
}

export function sanitize(event) {
  if (!event || typeof event !== 'object' || !ALLOWED.has(event.type)) return null;

  if (event.type === 'response.create') {
    const { instructions, ...response } = event.response ?? {};
    return { ...event, response };
  }

  if (event.type === 'conversation.item.create') {
    const item = event.item;
    if (!item) return null;
    if (item.type === 'function_call_output') {
      const ok = typeof item.call_id === 'string' && typeof item.output === 'string';
      return ok ? event : null;
    }
    if (item.type !== 'message' || item.role !== 'user') return null;
  }

  return event;
}

export function createRealtimeProxy(config) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (client, req) => {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const voice = config.voices.includes(params.get('voice'))
      ? params.get('voice')
      : config.defaultVoice;
    const model = config.models.includes(params.get('model'))
      ? params.get('model')
      : config.defaultModel;

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

    const tools = buildTools(config.tools);
    let pending = [];
    let memories = [];
    let history = [];

    const update = () => JSON.stringify({
      type: 'session.update',
      session: sessionConfig({ voice, tools, memories, resumed: history.length > 0 }),
    });

    /**
     * An earlier conversation, laid back down as items. It goes after the
     * session config, which explains what these turns are, and before anything
     * the page queued while the handshake was still in the air.
     */
    const replay = () => {
      for (const turn of history) upstream.send(JSON.stringify(historyItem(turn)));
    };

    upstream.on('open', () => {
      upstream.send(update());
      replay();
      for (const frame of pending) upstream.send(frame);
      pending = [];
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
      if (isBinary || data.length > MAX_FRAME) return;

      let incoming;
      try {
        incoming = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (incoming?.type === MEMORY_EVENT) {
        if (!config.tools.memory) return;
        memories = Array.isArray(incoming.memories) ? incoming.memories : [];
        if (upstream.readyState === WebSocket.OPEN) upstream.send(update());
        return;
      }

      /**
       * Picking a conversation up is something the page does as it dials, so
       * this normally lands while the handshake is still out and `open` does
       * the replaying. A late one still gets laid down, once.
       */
      if (incoming?.type === HISTORY_EVENT) {
        if (history.length) return;
        history = priorTurns(incoming.turns);
        if (history.length && upstream.readyState === WebSocket.OPEN) {
          upstream.send(update());
          replay();
        }
        return;
      }

      const event = sanitize(incoming);
      if (!event) return;

      const frame = JSON.stringify(event);
      if (upstream.readyState === WebSocket.OPEN) upstream.send(frame);
      else if (upstream.readyState === WebSocket.CONNECTING) pending.push(frame);
    });

    client.on('close', () => {
      pending = [];
      if (upstream.readyState === WebSocket.OPEN) upstream.close(1000);
      else upstream.terminate();
    });

    client.on('error', () => upstream.terminate());
  });

  return {
    handleUpgrade(req, socket, head) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    },
    close: () => wss.close(),
  };
}
