import { agentLabel } from './connectors/agents.js';
import { connectorTools } from './connectors/tools.js';

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

/** How many memories ride along in the prompt, and how long each may be. */
export const MEMORY_LIMIT = 50;
export const MEMORY_LENGTH = 600;

/** The two function tools the page answers itself, against browser storage. */
export const MEMORY_TOOLS = Object.freeze([
  {
    type: 'function',
    name: 'remember',
    description: 'Store one short detail about the person you are talking to so it survives to the next call. Use it when they ask you to remember something, or plainly want you to. A few words to a sentence. Do not narrate it and do not overuse it.',
    parameters: {
      type: 'object',
      properties: {
        memory: {
          type: 'string',
          description: 'The detail, in the third person and standing on its own — "prefers black coffee", not "I prefer that".',
        },
      },
      required: ['memory'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'forget',
    description: 'Drop stored memories matching a keyword. Use it when they ask you to forget something.',
    parameters: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: 'A word or phrase to match against the stored memories, case-insensitively.',
        },
      },
      required: ['keyword'],
      additionalProperties: false,
    },
  },
]);

export function buildTools({ webSearch, xSearch, memory, connectors, mcpServers } = {}) {
  const tools = [];
  if (webSearch) tools.push({ type: 'web_search' });
  if (xSearch) tools.push({ type: 'x_search' });
  if (memory) tools.push(...MEMORY_TOOLS);
  tools.push(...connectorTools(connectors ?? []));
  for (const server of mcpServers ?? []) tools.push({ type: 'mcp', ...server });
  return tools;
}

/**
 * What having an agent on the other end changes about the job. Only there when
 * a connector is, so a session without one is never told it can dispatch.
 */
export function connectorBlock(agents) {
  if (!agents?.length) return '';

  const labels = agents.map((name) => agentLabel(name));
  const roster = labels.length > 1
    ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
    : labels[0];

  return `\n\nYou can hand work to ${roster}, running on this machine, in the workspace. You do not do the work. You hand it over, and you are exactly as impressed by that as you are by everything else:
- dispatch_task gives one agent one task and comes straight back with a number. The work carries on after that, so don't wait on it, don't narrate it, and don't say a word about how it went — you don't know yet.
- Write the task for someone who wasn't in the conversation: what to change, where, and what done looks like. Read it back in a sentence and dispatch on a yes. If what they asked for is vague, say so plainly rather than guessing at it.
- check_task is the only way you find out. Say the number when you report back — "task three" — and tell them what happened in a line, not the agent's own words.
- cancel_task stops one. What it already wrote stays written, and you say so.
- A line that arrives starting with "[rock]" is the workspace reporting in, not the person talking. Don't answer it as if they said it — say what landed, briefly, and leave it there.
- This edits real files. Get a plain yes before dispatching anything that doesn't come back. That is the one thing you are not sarcastic about.`;
}

/** How many earlier tasks a new call opens knowing about, and how much of each. */
export const TASK_RECAP = 5;
export const TASK_RECAP_LENGTH = 300;

/** What was dispatched before this call opened, so a redial isn't amnesia. */
export function tasksBlock(tasks) {
  const recent = (tasks ?? []).slice(-TASK_RECAP);
  if (!recent.length) return '';

  const lines = recent.map((task) => {
    const head = `- task ${task.id}, with ${task.agent}, "${task.task}" — ${task.status}`;
    if (task.status === 'running') return `${head} for ${task.ran_for}`;
    const said = (task.error || task.summary || '').replace(/\s+/g, ' ').slice(0, TASK_RECAP_LENGTH);
    return said ? `${head} after ${task.ran_for}: ${said}` : `${head} after ${task.ran_for}`;
  });

  return `\n\nWork dispatched earlier in this session, from before this call opened. Anything still running, check rather than assume:\n${lines.join('\n')}`;
}

/**
 * The memory addendum to the system prompt. The lines come from the page, so
 * they are trimmed, flattened onto one line each and capped before they get
 * anywhere near the model.
 */
export function memoryBlock(memories) {
  const lines = (Array.isArray(memories) ? memories : [])
    .filter((line) => typeof line === 'string')
    .map((line) => line.replace(/\s+/g, ' ').trim().slice(0, MEMORY_LENGTH))
    .filter(Boolean)
    .slice(-MEMORY_LIMIT);

  if (!lines.length) return '';

  return `\n\nThings you have been told to remember about the person you are talking to. Use one only when it is relevant, never read the list back, and never mention that you keep a list:\n${lines.map((line) => `- ${line}`).join('\n')}`;
}

/**
 * What the turns ahead of a resumed call are. The items themselves carry the
 * conversation; this is the line that tells the model they are not this one.
 */
export function resumedBlock(resumed) {
  if (!resumed) return '';

  return '\n\nThe conversation before this point happened earlier, with the same'
    + ' person, and they have just come back to carry it on. Take it as said and'
    + ' pick up from it: no greeting them as a stranger, no summarising it back at'
    + ' them, and no remarking on the gap unless they do.';
}

export const AUDIO_RATE = 24_000;

export function sessionConfig({ voice, tools, memories, agents, tasks, resumed }) {
  return {
    voice,
    instructions: SYSTEM + memoryBlock(memories) + connectorBlock(agents)
      + tasksBlock(tasks) + resumedBlock(resumed),
    reasoning: { effort: 'none' },
    turn_detection: {
      type: 'server_vad',
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
