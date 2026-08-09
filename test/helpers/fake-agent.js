/**
 * Stands in for `openclaw` — same flags, same output shape, no model behind
 * it. Which one it is playing comes first on the command line, and what it
 * does comes from the task text itself:
 *
 *   ...fail     writes to stderr and exits non-zero
 *   ...sleep    stays up until it is killed
 *   ...quiet    exits cleanly having said nothing
 *   ...where    reports the directory it was actually started in
 *   ...refuse   prints an envelope that says the run failed, and exits 1
 */
const [shape, ...argv] = process.argv.slice(2);

/** `openclaw agent exec <task>`: the task is the first thing after `exec`. */
const task = argv[argv.indexOf('exec') + 1] ?? '';

/** One finished answer, in the machine format this one speaks. */
function said(text, extra = {}) {
  return JSON.stringify({
    ok: true,
    status: 'ok',
    final: text,
    payloads: [{ text }],
    usage: { input: 120, output: 8, total: 128 },
    model: 'gpt-5.6-sol',
    provider: 'openai',
    sessionId: 'fake-session',
    ...extra,
  });
}

if (/\bfail\b/.test(task)) {
  process.stderr.write('the build is on fire\n');
  process.exit(3);
}

if (/\bsleep\b/.test(task)) {
  setInterval(() => {}, 1000);
} else if (/\bquiet\b/.test(task)) {
  process.exit(0);
} else if (/\bwhere\b/.test(task)) {
  process.stdout.write(`${said(`cwd=${process.cwd()} PWD=${process.env.PWD} key=${process.env.XAI_API_KEY}`)}\n`);
} else if (/\brefuse\b/.test(task)) {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    status: 'error',
    final: '',
    payloads: [],
    error: { message: 'no provider is configured', kind: 'config' },
    model: null,
    provider: null,
  })}\n`);
  process.exit(1);
} else {
  process.stdout.write(`${said(`${shape} did: ${task}`, { assistantTurns: 2 })}\n`);
}
