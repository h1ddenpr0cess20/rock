/**
 * The certificate `npm start -- --https` serves with.
 *
 * Only a phone reaching a LAN address needs this: getUserMedia is exposed on
 * secure origins only, so `http://192.168.x.x` can't ask for a microphone at
 * all. `localhost` is already a secure origin — plain `npm start` stays HTTP
 * and needs nothing here.
 *
 * Two ways to get a certificate, in order:
 *
 *   SSL_KEY / SSL_CERT   paths to a real one, for anything public-facing
 *   neither              a self-signed one, generated on first use
 *
 * The self-signed path shares its certificate with `npm run dev:lan`, so a
 * phone that has already tapped through the warning for one doesn't have to do
 * it again for the other.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** Vite's cache directory: gitignored, and wiped by a clean reinstall. */
export const CERT_DIR = fileURLToPath(new URL('../../node_modules/.vite/basic-ssl', import.meta.url));

/**
 * @returns {Promise<{key: string, cert: string} | null>} null when the server
 *   should stay HTTP, which is the default.
 */
export async function loadTls({ https = false, env = process.env } = {}) {
  if (env.SSL_KEY && env.SSL_CERT) {
    const [key, cert] = await Promise.all([
      readFile(env.SSL_KEY, 'utf8'),
      readFile(env.SSL_CERT, 'utf8'),
    ]);
    return { key, cert };
  }

  if (!https) return null;

  // A devDependency, and deliberately imported only on this path: a deployment
  // running `npm ci --omit=dev` behind a real certificate never reaches it.
  let getCertificate;
  try {
    ({ getCertificate } = await import('@vitejs/plugin-basic-ssl'));
  } catch {
    throw new Error(
      '--https needs @vitejs/plugin-basic-ssl to generate a self-signed certificate. ' +
      'Run `npm install` with dev dependencies, or point SSL_KEY and SSL_CERT at a real one.',
    );
  }

  // One PEM holding both halves, which is what the plugin hands Vite too.
  const pem = await getCertificate(CERT_DIR);
  return { key: pem, cert: pem };
}
