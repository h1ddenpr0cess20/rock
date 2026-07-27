/**
 * Production entry point: the API and the socket proxy in front of the built
 * client.
 *
 * `npm run dev` does not come through here — Vite serves the page and mounts
 * the same middleware and the same proxy itself (see vite.config.js). This is
 * `npm start`, which expects `npm run build` to have produced dist/.
 */

import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();

createApp(config).listen(config.port, () => {
  console.log(`rock → http://localhost:${config.port}`);
  if (!config.apiKey) {
    console.warn('XAI_API_KEY is not set — the mic will fail until it is.');
  }
  const { webSearch, xSearch, mcpServers } = config.tools;
  const tools = [
    webSearch && 'web_search',
    xSearch && 'x_search',
    ...mcpServers.map((s) => `mcp:${s.server_label}`),
  ].filter(Boolean);
  console.log(`tools → ${tools.join(', ') || 'none'}`);
});
