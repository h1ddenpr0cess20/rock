# Rock

A voice agent rendered as a boulder. Several tons of granite that has been
sitting in the same spot for ten thousand years, is not impressed by your
question, and will answer it correctly anyway. Driven by an xAI Grok
speech-to-speech session; the rock's squash, stomp and sway are read off the
live audio, so it moves with whichever of you is talking.

It can search the web and X, and call remote MCP servers.

## Run

```sh
npm install
cp .env.example .env      # add your XAI_API_KEY
npm run dev               # → http://localhost:5173
```

Click the mic, allow the browser's microphone prompt, and start talking. Talk
over him and he'll stop — and stomp.

| Script | |
|---|---|
| `npm run dev` | Vite, with the proxy mounted as middleware — one process |
| `npm run build` | Bundles the client to `dist/` |
| `npm start` | Serves `dist/` with the same proxy in front |
| `npm run preview` | `build` then `start` |
| `npm test` | `node:test`, against a stub xAI socket |
| `npm run lint` | |

Open it on `localhost`. Microphone access needs a secure context, so serving
this from a LAN address over plain HTTP will fail at the mic prompt — put it
behind HTTPS if you want it off your own machine. `npm run dev -- --host` binds
to the network anyway, which is useful for checking layout on a phone even
though that phone won't get past the mic prompt.

| Variable | Default | Role |
|---|---|---|
| `XAI_API_KEY` | — | Required. Stays in the Node process. |
| `XAI_VOICE` | `rex` | The heavy end of xAI's roster — `rex`, `sal`, `atlas`, `zagan`, `orion`, `perseus`, `leo`, `helix`, `zenith`, `rigel`, `castor`, `ursa`, `naksh`, `kepler` — or any other voice id, which is honoured and added to the picker |
| `XAI_MODEL` | `grok-voice-latest` | Also `grok-voice-think-fast-1.0` |
| `XAI_REALTIME_URL` | xAI | Points the proxy at a gateway or a stub |
| `XAI_WEB_SEARCH` | `true` | |
| `XAI_X_SEARCH` | `true` | |
| `XAI_MCP_SERVERS` | — | JSON array of remote MCP servers, or put it in `mcp.json` |
| `PORT` | `5173` | |

Both `npm run dev` and `npm start` read `.env`.

## How the call is wired

Every frame of audio goes through the Node process:

```
browser  ──ws──▶  /realtime  ──ws──▶  wss://api.x.ai/v1/realtime
```

That is a deliberate cost, and it is the main way this differs from an
equivalent app on OpenAI's Realtime API. There, the browser dials the provider
directly with an ephemeral secret and audio never touches your server. Here it
can't:

- **xAI's `/v1/realtime/client_secrets` takes no `session` field.** The token it
  mints carries no configuration, so a page that dialled xAI directly would have
  to send its own `session.update` — putting the persona, the tool list and any
  MCP `authorization` header in client code, where they are readable and
  editable.
- **The token lasts five minutes.** Conversations routinely outlive that.

So the socket lives here, and the page holds no credential of any kind. On
connect, the proxy is the one that sends `session.update`: persona, voice,
turn detection, audio format, tools. Only then does it forward anything the
page queued.

What the page may say upstream is an allowlist, not a filter — audio frames, a
typed message, a request to respond, a cancel. Two frames are treated as
persona overrides and dropped: a `session.update` from the browser, and the
`instructions` field on a `response.create`, which replaces the system prompt
for one turn. `test/server/realtime.test.js` is the file that fails if that
stops being true.

## Audio

WebRTC would have handled this. A WebSocket carrying base64 PCM does not, so
both directions are the client's problem.

**Up:** an `AudioWorklet` (`public/pcm-worklet.js`) takes the mic at whatever
rate the hardware felt like, resamples to 24 kHz with linear interpolation, and
posts 20 ms PCM16 frames. The `sampleRate` option on `AudioContext` is a hint —
some browsers hand back the device rate, and a session that declares 24 kHz
while sending 48 sounds like a chipmunk — so the conversion is done rather than
requested.

**Down:** chunks arrive *faster than real time* — the model produces ten seconds
of speech in two — so playback can't be "play each as it lands" without
overlapping. Each chunk is booked against a cursor running ahead of the clock.
That cursor is also what makes barge-in work: interrupting means dropping
everything booked but not yet heard, which is most of the answer.

Turn-taking is server-side VAD, so speaking over Rock stops him generating;
`input_audio_buffer.speech_started` is what tells the page to drop its queue. A
new `response.created` arriving while audio is still playing flushes it too, as
a backstop for a turn cut short without notice. `Escape` cancels for the typed
path.

The worklet lives in `public/` rather than being imported. Vite inlines assets
under its size limit as `data:text/javascript` URLs, and `addModule()` rejects
those on Safari and under any CSP that doesn't allow `data:` — it works in dev
and breaks in production, silently.

## Tools

`web_search` and `x_search` are on by default. Both execute inside xAI, so
there is nothing to implement here and no second credential to hold — they cost
a flag in `.env`. Rock is told not to narrate a search, so the only sign one is
running is the label under the status chip.

Remote **MCP** servers go in `XAI_MCP_SERVERS` as a JSON array, or in `mcp.json`
(gitignored), and are executed by xAI as well:

```json
[
  {
    "server_label": "orders",
    "server_url": "https://mcp.example.com/mcp",
    "server_description": "Order lookup",
    "allowed_tools": ["lookup_order"],
    "authorization": "Bearer ..."
  }
]
```

Credentials in that file never leave the Node process. `/api/config` reports
tool *labels* only, which is what the strip under the composer renders.

Client-side function tools are the one kind not wired up: `session.tools` would
take them, but they need a `function_call_output` path back through the proxy's
allowlist, and nothing here has wanted one yet.

## Layout

```
index.html              Markup only — Vite's entry
public/
  pcm-worklet.js        Mic → 24 kHz PCM16, on the audio thread
src/
  client/
    main.js             The wiring, and nothing else
    styles.css          The HUD around the boulder
    api.js              /api/config, as a function
    boulder/            Geometry and animation. Knows nothing about transports
      index.js            The controller and the per-frame loop
      geometry.js         Noise, cutting planes, vertex colours
      moods.js            Targets per conversational state
      environment.js      Studio env map
    session/            The call. Emits transport-agnostic events
      index.js            Lifecycle: mic, socket, meter, tear down
      socket.js           The WebSocket to our own proxy
      audio.js            Capture and playback over Web Audio
      codec.js            PCM16 ↔ base64
      events.js           xAI server events → this vocabulary
      metering.js         An analyser → one 0..1 number per frame
      emitter.js
      constants.js        The wire format, shared with the server
    ui/                 What you read and what you press
      hud.js              Status chip, transcript, caption, tool label
      controls.js         Mic, text field, send, pickers
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
test/                   node:test, against a stub xAI socket
```

`src/client/boulder/` is a single-file prototype (`boulder-buddy.html`) split
into modules; the original is in the first commit if you want to see where it
started. `src/client/vendor/three-d-stage.js` is a copied starter component
with two local changes, listed at the top of the file — re-copying it drops
them.

## States

`idle` · `listening` · `thinking` · `speaking` — each a set of targets for
tremor, lean, sway, sway speed and whether the rock paces. It eases between
them, so transitions read as the same creature changing mood rather than a cut.

The call maps onto them directly: `listening` from `speech_started` and between
turns, `thinking` from `speech_stopped` until the first audio frame, `speaking`
while there is audio booked, `idle` when there is no call.

There is a fifth mood, `angry`, that no conversational state maps to. It is
reached by interrupting him, decays over a couple of seconds, and blends over
whatever he was doing rather than replacing it.

Nothing here is a sine wave dressed up as motion. Every visible movement is a
damped spring reacting to an impulse — the rock lands, and the landing shoves
it. Stiff springs and heavy damping are what make it read as several tons
instead of a bouncing ball. While he talks, the shoves come from onsets in the
audio envelope, so the squash lands on consonants and it looks like it is
forming words.

## The transport seam

`session/index.js` exposes `on`, `start`, `stop`, `send`, `cancel`, `messages`,
`connected`, `busy`, `stale`, `state`, `model`, `voice` — and emits:

```
'state'        listening | thinking | speaking | idle
'caption'      the assistant transcript for this turn, in full
'user'         what the person said, in full
'level'        0..1 sustained amplitude, per frame
'pulse'        0..1 transient, one per discrete event
'interrupted'  the person talked over Rock
'tool'         a label while a server-side tool works, or null
'busy'         whether a response is in flight
'ready'        { model, voice } the proxy actually used
'done'         { usage }
'error'        { message }
```

Both transcript events carry the whole turn rather than an increment. That is
an xAI divergence worth knowing about: it renames OpenAI's
`input_audio_transcription.delta` to `.updated` and makes it *cumulative*, so
appending it gives you "hello hello there hello there rock". `events.js`
handles the two shapes apart — `.delta` appends, `.updated` replaces.

The boulder takes audio-shaped input, which is the whole point of the split:

```js
boulder.setState('speaking')  // idle | listening | thinking | speaking
boulder.setLevel(0.62)        // sustained amplitude 0..1, sampled per frame
boulder.pulse(0.4)            // transient impulse 0..1, one per discrete event
boulder.anger(0.9)            // it has been interrupted and it is not pleased
```

Swapping providers means writing a different `createVoiceSession()` with that
surface. `main.js` and the boulder do not change.
