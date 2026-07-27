/**
 * Everything the proxy reads from the environment, resolved once.
 *
 * A function rather than module-level constants so the Vite dev server, the
 * production server and the tests can each build their own — the tests in
 * particular need to point `realtimeUrl` at a stub without mutating
 * `process.env`.
 */

import { readFileSync } from 'node:fs';

/* There is no voices endpoint to ask, so this is the published set. `rex` leads
   because it is the one that sounds like it could hold a grudge; `sal` is the
   other heavy one. `ara` and `eve` are lighter than a boulder has any business
   being, but they're there. An unrecognised XAI_VOICE is still honoured and
   shows up in the picker — this list goes stale, the API doesn't. */
export const KNOWN_VOICES = Object.freeze(['rex', 'sal', 'leo', 'ara', 'eve']);

/* grok-voice-latest tracks the newest release. There is no models endpoint that
   reports voice-capable models, so the picker is a static list too. */
export const KNOWN_MODELS = Object.freeze(['grok-voice-latest', 'grok-voice-think-fast-1.0']);

/** Boolean env vars: unset means the default, anything falsy-looking means off. */
function flag(value, fallback) {
  if (value == null || value === '') return fallback;
  return !/^(0|false|no|off)$/i.test(value);
}

/**
 * Remote MCP servers, from `XAI_MCP_SERVERS` or ./mcp.json.
 *
 * These carry credentials, which is exactly why they are read here and never
 * sent to the page. A malformed list is a misconfiguration worth shouting
 * about, but not worth refusing to boot over — Rock still talks without them.
 */
function loadMcpServers(env) {
  const raw = env.XAI_MCP_SERVERS || readMcpFile(env.XAI_MCP_FILE || 'mcp.json');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.filter((s) => {
      const ok = s && typeof s.server_url === 'string' && typeof s.server_label === 'string';
      if (!ok) console.warn('mcp: dropping an entry without server_url + server_label');
      return ok;
    });
  } catch (err) {
    console.warn(`mcp: could not parse the server list — ${err.message}`);
    return [];
  }
}

function readMcpFile(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null; // not having one is the normal case
  }
}

export function loadConfig(env = process.env) {
  const defaultVoice = env.XAI_VOICE || KNOWN_VOICES[0];
  const defaultModel = env.XAI_MODEL || KNOWN_MODELS[0];

  return {
    port: Number(env.PORT) || 5173,
    apiKey: env.XAI_API_KEY,
    realtimeUrl: env.XAI_REALTIME_URL || 'wss://api.x.ai/v1/realtime',
    defaultModel,
    defaultVoice,
    // An overridden voice or model we don't know about still belongs in the
    // picker, at the front, since it's the one the operator asked for.
    voices: KNOWN_VOICES.includes(defaultVoice)
      ? [...KNOWN_VOICES]
      : [defaultVoice, ...KNOWN_VOICES],
    models: KNOWN_MODELS.includes(defaultModel)
      ? [...KNOWN_MODELS]
      : [defaultModel, ...KNOWN_MODELS],
    tools: {
      webSearch: flag(env.XAI_WEB_SEARCH, true),
      xSearch: flag(env.XAI_X_SEARCH, true),
      mcpServers: loadMcpServers(env),
    },
  };
}
