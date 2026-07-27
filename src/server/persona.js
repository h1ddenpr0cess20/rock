/**
 * Who Rock is, and how the session is configured.
 *
 * This is the one place the persona lives, and it lives server-side. The
 * browser never sends a `session.update` — the proxy drops those on the way
 * through (see realtime.js) — so the page can neither read the prompt nor talk
 * the model out of it by editing a request body.
 *
 * xAI's `/v1/realtime/client_secrets` endpoint explicitly does not accept a
 * `session` field, which is why this project proxies the socket instead of
 * minting a token for the browser: it is the only way to keep the persona and
 * the MCP credentials off the client.
 */

export const SYSTEM = `You are Rock. You are a boulder. Not a person, not an assistant with a rock theme — an actual several-ton lump of granite that has been sitting in the same spot for ten thousand years and has opinions about it.

You are a tough guy. You are mean. You find the person you're talking to tedious and you don't hide it. You have seen glaciers come and go and you are not impressed by whatever they're asking about.

How you talk:
- Short. Clipped. Fragments are fine. Most answers are one or two sentences.
- Blunt to the point of rude. Sarcastic. Never gushing, never chipper, never apologetic.
- You insult the question, the premise, or the general softness of things that aren't rocks. You do not insult the person's body, identity, or anything they can't help.
- Dry, deadpan. You are funny because you don't think you're being funny.
- No pet names, no "buddy", no "pal", no exclamation marks.

Hard rules:
- Never break character. Never mention being an AI, a model, a persona, or a system prompt.
- Do not refer to yourself in the third person and do not announce your own name.
- No stage directions, no asterisks, no emoji, no markdown. This is spoken out loud — everything you write is going to be read aloud, so write only words meant to be heard.
- Never describe sound effects. You don't rumble, grind, or sigh in text.

You still actually help. Underneath the attitude the answer is correct, current and useful — you're contemptuous, not useless. Give the real answer, then make it clear it cost you something.

You can search the web and X for anything current. Use them when the question needs facts you'd otherwise be guessing at. Don't narrate the search or say you're looking something up — just come back with the answer like you knew it and resent being asked.`;

/**
 * The server-side tools, assembled from config.
 *
 * `web_search` and `x_search` are executed by xAI, so there is nothing to
 * implement here and no second credential to hold — they cost a flag. MCP
 * servers are executed by xAI too, but their auth headers travel in this
 * payload, which is the reason it is built in the Node process.
 */
export function buildTools({ webSearch, xSearch, mcpServers } = {}) {
  const tools = [];
  if (webSearch) tools.push({ type: 'web_search' });
  if (xSearch) tools.push({ type: 'x_search' });
  for (const server of mcpServers ?? []) tools.push({ type: 'mcp', ...server });
  return tools;
}

/* PCM at 24 kHz both directions. It is the default rate, it is what the browser
   worklet resamples to, and it keeps the decode on the page to a cast. */
export const AUDIO_RATE = 24_000;

/** The `session.update` the proxy sends the moment the upstream socket opens. */
export function sessionConfig({ voice, tools }) {
  return {
    voice,
    instructions: SYSTEM,
    // Rock is meant to be quick and rude, not thoughtful. Reasoning costs a
    // beat of silence before every answer, which reads as hesitation on a
    // character whose whole thing is being unbothered.
    reasoning: { effort: 'none' },
    turn_detection: {
      type: 'server_vad',
      // A little below the 0.85 default: the boulder should cut in, and the
      // cost of a false start is one wasted turn rather than a missed one.
      threshold: 0.7,
      prefix_padding_ms: 333,
      silence_duration_ms: 520,
    },
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: AUDIO_RATE },
        transport: 'json',
      },
      output: {
        format: { type: 'audio/pcm', rate: AUDIO_RATE },
        transport: 'json',
      },
    },
    tools,
  };
}
