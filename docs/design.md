# Design notes

How Rock is put together. The [README](../README.md) covers running it;
[configuration](configuration.md) covers the knobs.

## How the call is wired

Every frame of audio goes through the Node process:

```
browser  ──ws──▶  /realtime  ──ws──▶  wss://api.x.ai/v1/realtime
```

Unlike OpenAI's Realtime API, the browser can't dial xAI directly.
`/v1/realtime/client_secrets` takes no `session` field, so a page dialling xAI
itself would have to send its own `session.update` — putting the persona, the
tool list and any MCP `authorization` header in client code. The token also
lasts five minutes, and conversations routinely outlive that.

So the socket lives here and the page holds no credential. On connect the proxy
sends `session.update` — persona, voice, turn detection, audio format, tools —
before forwarding anything the page queued.

What the page may send upstream is an allowlist: audio frames, a typed message,
a request to respond, a cancel, and the output of a function call it ran itself.
Two things are dropped as persona overrides — a `session.update` from the
browser, and the `instructions` field on a `response.create`.
`test/server/realtime.test.js` covers that.

One frame type never reaches xAI: `session.memory`, which the page sends with
what it has stored. The proxy folds those lines into the instructions and
re-sends its own `session.update`, so the persona stays here and the memories
stay in the browser.

## Audio

A WebSocket carrying base64 PCM leaves both directions to the client.

**Up:** an `AudioWorklet` (`public/pcm-worklet.js`) takes the mic at whatever
rate the hardware gives, resamples to 24 kHz with linear interpolation, and
posts 20 ms PCM16 frames. The `sampleRate` option on `AudioContext` is only a
hint, so the conversion is done rather than requested.

**Down:** chunks arrive faster than real time, so each is booked against a
cursor running ahead of the clock rather than played as it lands. That cursor is
also what makes barge-in work — interrupting drops everything booked but not yet
heard.

Turn-taking is server-side VAD. `input_audio_buffer.speech_started` tells the
page to drop its queue; a `response.created` arriving while audio is still
playing flushes it too, as a backstop. `Escape` cancels for the typed path.

The worklet lives in `public/` rather than being imported, because Vite inlines
small assets as `data:text/javascript` URLs and `addModule()` rejects those on
Safari and under any CSP that disallows `data:`.

## Storage

The log is one record per call under `rock.history.v1`; memory is a list of
lines under `rock.memory.v1`. Neither is uploaded — the proxy holds no copy of
either.

The last 40 conversations are kept, and the oldest are shed to stay inside a
300 KB budget, since that space belongs to the whole origin. Private-mode Safari
hands back a store that throws on write, so the log falls back to memory for the
life of the page rather than failing the call.

Old turns are not replayed into a new call on their own — that would make the
log a memory rather than a record. `continue` on an entry in the log is the one
way past that, and it is asked for, once, per conversation.

What goes up then is the conversation itself, not a description of one. The page
sends `session.history` — its own frame, handled here and never forwarded — and
the proxy lays the turns back down upstream as items, one `conversation.item.create`
each: a user message carrying `input_text`, an assistant message carrying
`output_text`. That is the shape the realtime API takes for history, and it is
the only shape that works. Flattening a transcript into a single message leaves
the model with no history at all, only somebody telling it about one — it will
treat the first thing said in the new call as the first thing ever said.

Both roles carry `input_text`. xAI documents history seeding with a user text
message or an assistant text message and `input_text` as the content type for a
text message either way — it follows OpenAI's beta naming here, the same way it
does for the text events `events.js` has to handle two spellings of. OpenAI's GA
shape puts assistant text in `output_text`; that is not this API.

The turns arrive as turns rather than as items so the page never names a role:
it hands over what was said, and `realtime.js` decides what goes upstream. The
line explaining that those turns are an earlier conversation is part of the
instructions, so it stays server-side with the rest of the persona.

Both ends cap the replay at 40 turns and 6 KB, oldest shed first, and the cap is
a bill as well as a budget: xAI charges per `conversation.item.create` the client
sends, so a picked-up conversation costs its turns, once, at the moment it is
picked up. Lowering the cap lowers that; it is one constant at each end.

Memory is capped at 25 lines, each flattened to one line and cut at 600
characters; past the cap the oldest goes. `remember` and `forget` run in the
page against browser storage, and the result goes back up as a
`function_call_output`. Editing the list during a call re-sends
`session.memory`, so a memory added mid-conversation is live in it; switching
memory off empties the block on the next `session.update` without deleting
anything.

Memories are text the person typed or dictated, so they land inside the prompt.
Flattening and capping them in `persona.js` keeps a memory from opening a new
instruction paragraph, and the persona is always first in the string.

## States

`idle` · `listening` · `thinking` · `speaking` — each a set of targets for
tremor, lean, sway, sway speed and whether the rock paces. It eases between
them, so transitions read as a change of mood rather than a cut.

The call maps onto them directly: `listening` from `speech_started` and between
turns, `thinking` from `speech_stopped` until the first audio frame, `speaking`
while there is audio booked, `idle` when there is no call.

A fifth mood, `angry`, has no conversational state. It's reached by interrupting
him, decays over a couple of seconds, and blends over whatever he was doing.

Every visible movement is a damped spring reacting to an impulse rather than a
sine wave. While he talks, the impulses come from onsets in the audio envelope,
so the squash lands on consonants.

## Layout

```
Dockerfile              Build the client, then serve it from src/server
index.html              Markup only — Vite's entry
public/
  pcm-worklet.js        Mic → 24 kHz PCM16, on the audio thread
src/
  client/
    main.js             The wiring, and nothing else
    styles.css          The HUD around the boulder
    api.js              /api/config, as a function
    history.js          Past conversations in localStorage, and picking one up
    memory.js           What he remembers between calls, in localStorage
    boulder/            Geometry and animation. Knows nothing about transports
      index.js            The controller and the per-frame loop
      geometry.js         Noise, cutting planes, vertex colours
      moods.js            Targets per conversational state
      environment.js      Studio env map
    session/            The call. Emits transport-agnostic events
      index.js            Lifecycle: mic, socket, meter, tear down
      socket.js           The WebSocket to our own proxy, memories and history
      audio.js            Capture and playback over Web Audio
      codec.js            PCM16 ↔ base64
      events.js           xAI server events → this vocabulary
      tools.js            remember/forget, run in the page
      metering.js         An analyser → one 0..1 number per frame
      emitter.js
      constants.js        The wire format, shared with the server
    ui/
      hud.js              Status chip, transcript, caption, tool label
      history.js          The log panel behind `log`, and its `continue`
      memory.js           The memory panel behind the `memory` button
      controls.js         Mic (tap mutes, hold hangs up), field, send, pickers
      viewport.js         Keeps the composer above the on-screen keyboard
      stage.js            Strips the starter component's own chrome
    vendor/
      three-d-stage.js    Starter component (renderer, lighting, camera, controls)
  server/
    index.js            Entry point
    app.js              Middleware chain + the upgrade handler
    api.js              /api/config
    realtime.js         The socket proxy, and the allowlist
    persona.js          Who Rock is, and the session config
    config.js           The environment, resolved once
    static.js           Hosting for dist/ — production only
docs/                   These notes, configuration, policies, screenshots
test/                   node:test, against a stub xAI socket
.github/workflows/      CI (lint, tests, build smoke test) and the Docker publish
```

`src/client/boulder/` started as a single-file prototype
(`boulder-buddy.html`), still in the first commit.
`src/client/vendor/three-d-stage.js` is a copied starter component with two
local changes, listed at the top of the file — re-copying it drops them.

## The transport seam

`session/index.js` exposes `on`, `start`, `stop`, `send`, `cancel`, `syncMemory`,
`messages`, `context`, `connected`, `busy`, `stale`, `state`, `muted`, `model`,
`voice` — and emits:

```
'state'        listening | thinking | speaking | idle
'caption'      the assistant transcript for this turn, in full
'user'         what the person said, in full
'level'        0..1 sustained amplitude, per frame
'pulse'        0..1 transient, one per discrete event
'interrupted'  the person talked over Rock
'tool'         a label while a tool works, or null
'message'      a completed turn, { role, content } — what the log stores
'busy'         whether a response is in flight
'ready'        { model, voice } the proxy actually used
'memory'       the result of a remember/forget the model just called
'done'         { usage }
'error'        { message }
```

Both transcript events carry the whole turn rather than an increment. xAI
renames OpenAI's `input_audio_transcription.delta` to `.updated` and makes it
cumulative, so appending it gives you "hello hello there hello there rock".
`events.js` handles the two shapes apart — `.delta` appends, `.updated`
replaces.

The boulder takes audio-shaped input:

```js
boulder.setState('speaking')  // idle | listening | thinking | speaking
boulder.setLevel(0.62)        // sustained amplitude 0..1, sampled per frame
boulder.pulse(0.4)            // transient impulse 0..1, one per discrete event
boulder.anger(0.9)            // it has been interrupted
```

Swapping providers means writing a different `createVoiceSession()` with that
surface. `main.js` and the boulder don't change.
