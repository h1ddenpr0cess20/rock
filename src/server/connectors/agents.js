/**
 * The agents a task can be handed to, as command lines.
 *
 * Each is run headless, once per task, in the workspace directory — no TTY, no
 * prompt to answer, nothing to attend to while they work. What comes back on
 * stdout is a machine format that a CLI is free to rename a field in, so the
 * parsers take the shape they know and fall back to the tail of the output
 * rather than failing a task over it.
 */

/** How much of an agent's answer rides back to the model. It gets read aloud. */
export const SUMMARY_LENGTH = 1200;

export const AGENTS = Object.freeze({
  openclaw: {
    label: 'OpenClaw',
    command: 'openclaw',
    /**
     * Where the run reads its setup from, narrowest first. `isolated` ignores
     * the machine's own OpenClaw config and takes exec's defaults, which keep
     * the filesystem tools inside the workspace we hand it. `ambient` is that
     * config, whatever it says — providers, plugins, channels, sandbox — and
     * it wins over the defaults wherever it sets something.
     */
    modes: ['isolated', 'ambient'],
    /** What it is switched on as: enough to do the work, no wider. */
    defaultMode: 'isolated',
    /**
     * `agent exec` is the headless path: one turn, no gateway, a temporary
     * state directory it cleans up after itself, and a JSON envelope at the
     * end. `--timeout 0` takes its own ten-minute deadline off — the time
     * limit that counts is the connector's, which is the one the panel shows
     * and the one that actually kills the process. Anything in `extra` lands
     * after these, so an operator who wants its deadline back can say so.
     */
    args({ task, model, mode, extra, cwd }) {
      return [
        'agent', 'exec', task,
        '--json',
        '--timeout', '0',
        ...(cwd ? ['--cwd', cwd] : []),
        ...(mode === 'isolated' ? ['--isolated'] : []),
        ...(model ? ['--model', model] : []),
        ...extra,
      ];
    },
    /**
     * The envelope is one document: `ok`, a `status` of ok, error or timeout,
     * and the final assistant text under `final`. A failure carries `error`,
     * and both are worth reading — a run can fail with something said.
     */
    parse(stdout, stderr) {
      const last = findLast(jsonObjects(stdout), (o) => typeof o.status === 'string' || 'final' in o);
      if (last) {
        const said = typeof last.final === 'string' && last.final.trim()
          ? last.final
          : payloadText(last);
        if (last.ok === false || (last.status && last.status !== 'ok')) {
          const why = last.error?.message || (last.status === 'timeout' ? 'it ran past its own deadline' : '');
          return { summary: trim(said), error: trim(why) || 'the run reported an error' };
        }
        return { summary: trim(said) || trim(fallback(stdout, stderr)) };
      }
      return { summary: trim(fallback(stdout, stderr)) };
    },
  },
});

export const AGENT_NAMES = Object.freeze(Object.keys(AGENTS));

export function agentLabel(name) {
  return AGENTS[name]?.label ?? name;
}

/**
 * A command line from the environment, split the way a shell would split the
 * simple half of one — so `OPENCLAW_COMMAND` can wrap the CLI in `npx`, `docker
 * exec`, or anything else that ends up taking the flags we append.
 */
export function splitArgs(line) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (let m = re.exec(line ?? ''); m; m = re.exec(line ?? '')) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

function trim(text) {
  const flat = (text ?? '').trim();
  return flat.length > SUMMARY_LENGTH ? `…${flat.slice(-SUMMARY_LENGTH)}` : flat;
}

function findLast(list, ok) {
  for (let i = list.length - 1; i >= 0; i--) if (ok(list[i])) return list[i];
  return null;
}

/** The envelope's other copy of what was said, for a build that drops `final`. */
function payloadText(envelope) {
  const payloads = Array.isArray(envelope.payloads) ? envelope.payloads : [];
  for (let i = payloads.length - 1; i >= 0; i--) {
    const text = payloads[i]?.text;
    if (typeof text === 'string' && text.trim()) return text;
  }
  return '';
}

/**
 * Every JSON object in the output, in order. A CLI is free to print one
 * document or one event per line, and a stray log line in the middle of either
 * is not a reason to lose the rest.
 */
function jsonObjects(text) {
  const whole = (text ?? '').trim();
  if (!whole) return [];

  try {
    const parsed = JSON.parse(whole);
    return Array.isArray(parsed) ? parsed.filter(isObject) : [parsed].filter(isObject);
  } catch {
    // Not one document, so read it as a line per event.
  }

  const found = [];
  for (const line of whole.split('\n')) {
    const start = line.trim();
    if (!start.startsWith('{') && !start.startsWith('[')) continue;
    try {
      const parsed = JSON.parse(start);
      for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
        if (isObject(item)) found.push(item);
      }
    } catch {
      // A partial line, or prose that happens to open with a brace.
    }
  }
  return found;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object';
}

/** No format we recognise: keep the end of what it actually printed. */
function fallback(stdout, stderr) {
  const prose = (stdout ?? '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('{'))
    .join('\n')
    .trim();
  return prose || (stdout ?? '').trim() || (stderr ?? '').trim();
}
