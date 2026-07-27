import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig, loadEnv } from 'vite';

import { createApiMiddleware } from './src/server/api.js';
import { loadConfig } from './src/server/config.js';
import { REALTIME_PATH } from './src/server/app.js';
import { createRealtimeProxy } from './src/server/realtime.js';
import { CERT_DIR } from './src/server/tls.js';

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

  // `npm run dev:lan`, for talking to Rock from a phone on the same wifi.
  //
  // getUserMedia is only exposed on a secure origin, and a LAN address over
  // plain HTTP is not one — the mic isn't refused there, the whole
  // navigator.mediaDevices namespace is missing. So the LAN dev server serves
  // HTTPS with a self-signed certificate, which no browser trusts: the phone
  // shows a warning, and tapping through it once per device is the price of a
  // secure context without a real certificate. The mic works after that, and
  // the page's socket follows the page onto wss: by itself.
  const lan = mode === 'lan';

  return {
    plugins: [rockApi(env), ...(lan ? [basicSsl({ certDir: CERT_DIR })] : [])],
    server: {
      port: Number(env.PORT) || 5173,
      // Phones on the same wifi. Without `dev:lan` this is layout work only.
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
