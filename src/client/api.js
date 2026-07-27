/**
 * The proxy's one endpoint, as a function.
 *
 * Throws on failure with the proxy's own message, which is written to be shown
 * to a person — the caption renders it verbatim.
 */

/**
 * @returns {Promise<{
 *   models: string[], model: string,
 *   voices: string[], voice: string,
 *   tools: { web_search: boolean, x_search: boolean, mcp: string[] },
 *   ready: boolean,
 * }>}
 */
export async function fetchConfig() {
  const res = await fetch('/api/config');
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `/api/config returned ${res.status}`);
  return body;
}
