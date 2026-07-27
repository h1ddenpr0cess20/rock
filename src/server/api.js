/**
 * The `/api` surface, as connect-style middleware.
 *
 * Middleware rather than a server so there is exactly one implementation: the
 * Vite dev server mounts it (see vite.config.js) and the production server
 * mounts it in front of the static handler. Anything that isn't `/api/*` falls
 * through to `next()`.
 *
 *   GET /api/config → the pickers' contents and which tools are live.
 *
 * That is the whole surface. The conversation itself is a WebSocket, not a
 * request/response pair, and it is handled by realtime.js.
 */

function sendJSON(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function createApiMiddleware(config) {
  return function api(req, res, next) {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/')) return next();

    if (path === '/api/config' && req.method === 'GET') {
      return sendJSON(res, 200, {
        models: config.models,
        model: config.defaultModel,
        voices: config.voices,
        voice: config.defaultVoice,
        // What the page shows in the tool strip. Labels only — an MCP server's
        // URL and its authorization header stay in this process.
        tools: {
          web_search: config.tools.webSearch,
          x_search: config.tools.xSearch,
          mcp: config.tools.mcpServers.map((s) => s.server_label),
        },
        // Rendered as the error the mic button would otherwise hit.
        ready: Boolean(config.apiKey),
      });
    }

    sendJSON(res, 404, { error: `no route for ${req.method} ${path}` });
  };
}
