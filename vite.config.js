import { defineConfig, loadEnv } from 'vite';

import { createApiMiddleware } from './src/server/api.js';
import { loadConfig } from './src/server/config.js';
import { REALTIME_PATH } from './src/server/app.js';
import { createRealtimeProxy } from './src/server/realtime.js';

/**
 * The dev server runs the real proxy.
 *
 * Not a `server.proxy` entry pointing at a second process — the API is
 * middleware and the socket proxy is a plain upgrade handler, so Vite mounts
 * the same code `npm start` does. One process, one implementation, and the key
 * never leaves it.
 */
function rockApi(env) {
  const config = loadConfig({ ...process.env, ...env });
  return {
    name: 'rock-api',
    configureServer(server) {
      server.middlewares.use(createApiMiddleware(config));

      // Vite's HMR socket comes through the same event, so the path check is
      // load-bearing: claim /realtime, leave everything else alone.
      const realtime = createRealtimeProxy(config);
      server.httpServer?.on('upgrade', (req, socket, head) => {
        if (req.url.split('?')[0] !== REALTIME_PATH) return;
        realtime.handleUpgrade(req, socket, head);
      });

      if (!config.apiKey) {
        server.config.logger.warn('XAI_API_KEY is not set — the mic will fail until it is.');
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // '' as the prefix: these are server-side secrets, so they are deliberately
  // read here and never exposed to client code as import.meta.env.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [rockApi(env)],
    server: {
      port: Number(env.PORT) || 5173,
      // Phones on the same wifi. Note that getUserMedia needs a secure context,
      // so a LAN address over plain HTTP still won't get past the mic prompt —
      // `npm run dev -- --host` is for layout work, not for talking to it.
      host: true,
    },
    resolve: {
      // What the starter component's import map called three's example modules.
      alias: { 'three/addons/': 'three/examples/jsm/' },
    },
    build: {
      target: 'es2022',
      sourcemap: true,
      // three is ~180 kB gzipped and it is most of the point of the page, so
      // the default 500 kB warning has nothing useful to say.
      chunkSizeWarningLimit: 800,
    },
  };
});
