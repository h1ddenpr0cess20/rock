# Rock

A voice agent rendered as a boulder — several tons of granite that is not
impressed by your question and answers it correctly anyway. It runs on an xAI
Grok speech-to-speech session, and its squash, stomp and sway are driven by the
live audio, so it moves with whichever of you is talking.

It can search the web and X, and call remote MCP servers. It also remembers
what you tell it to, between calls.

## Run

```sh
npm install
cp .env.example .env      # add your XAI_API_KEY
npm run dev               # → http://localhost:5173
```

Click the mic, allow the browser's microphone prompt, and start talking. Talk
over him and he stops — and stomps.

The mic button is a microphone switch, not a hang-up: turning it off stops what
you send and leaves the answer playing, and the conversation is still there when
you turn it back on. The mic also turns itself off after a minute of nothing
said, so it isn't hot on a call nobody is having — the call and everything said
on it survive that too.

| Script | |
|---|---|
| `npm run dev` | Vite, with the proxy mounted as middleware — one process |
| `npm run dev:lan` | The same, over HTTPS on the network — for a phone |
| `npm run build` | Bundles the client to `dist/` |
| `npm start` | Serves `dist/` with the same proxy in front |
| `npm run preview` | `build` then `start` |
| `npm run preview:lan` | `build` then `start`, over HTTPS on the network |
| `npm test` | `node:test`, against a stub xAI socket |
| `npm run lint` | ESLint |

CI runs the lint, the tests on Node 22.12 and 24, and a build that then has to
boot and serve itself over both HTTP and HTTPS.

## Configuration

Both `npm run dev` and `npm start` read `.env`.

| Variable | Default | Role |
|---|---|---|
| `XAI_API_KEY` | — | Required. Stays in the Node process. |
| `XAI_VOICE` | `rex` | The heavy end of xAI's roster: `rex`, `sal`, `atlas`, `zagan`, `orion`, `perseus`, `leo`, `helix`, `zenith`, `rigel`, `castor`, `ursa`, `naksh`, `kepler`. Any other voice id is honoured and added to the picker. |
| `XAI_MODEL` | `grok-voice-latest` | Also `grok-voice-think-fast-1.0` |
| `XAI_REALTIME_URL` | xAI | Points the proxy at a gateway or a stub |
| `XAI_WEB_SEARCH` | `true` | |
| `XAI_X_SEARCH` | `true` | |
| `MEMORY` | `true` | The `remember` and `forget` tools, and the memory block in the prompt |
| `XAI_MCP_SERVERS` | — | JSON array of remote MCP servers, or put it in `mcp.json` |
| `PORT` | `5173` | |
| `SSL_KEY`, `SSL_CERT` | — | Paths to a real certificate; `npm start` then serves HTTPS |

### On a phone

```sh
npm run dev:lan           # → https://192.168.x.x:5173, printed on start
```

Microphone access needs a secure context. `localhost` is one; a LAN address over
plain HTTP is not — `navigator.mediaDevices` doesn't exist there, so the page
can't even raise the mic prompt. The `:lan` scripts serve HTTPS with a
self-signed certificate, and the realtime socket follows the page onto `wss:`.

No browser trusts that certificate, so the phone shows a warning the first time
("Advanced" → proceed on Chrome, "Show details" → "visit this website" on
Safari). Tap through it once per device. The certificate is cached in
`node_modules/.vite/` and shared by both `:lan` scripts.

To skip the warning, bring a certificate the device already trusts —
[mkcert](https://github.com/FiloSottile/mkcert) issues one for a LAN IP — and
point `SSL_KEY` and `SSL_CERT` at it. `npm start` then serves HTTPS without the
`--https` flag.

## Docker

```sh
docker run --rm -p 5173:5173 -e XAI_API_KEY=xai-... h1ddenpr0cess20/rock
```

Images go to Docker Hub on every push to `main` (`latest`) and on `v*` tags
(`1.2.3`, `1.2`), built for `linux/amd64` and `linux/arm64`. Configuration is the
same set of variables as `.env` — pass them with `-e` or `--env-file .env`.

The container serves HTTP on `PORT` (5173 by default) and expects TLS to be
terminated in front of it. To serve TLS from the container instead, mount a
certificate and point `SSL_KEY` and `SSL_CERT` at it; the self-signed `--https`
path needs a devDependency that the production image doesn't carry.

To build it yourself:

```sh
docker build -t rock .
```

Publishing from a fork needs a `DOCKERHUB_TOKEN` repository secret, plus a
`DOCKERHUB_USERNAME` repository variable if your Docker Hub account isn't
`h1ddenpr0cess20`.

## How the call is wired

Every frame of audio goes through the Node process:

```
browser  ──ws──▶  /realtime  ──ws──▶  wss://api.x.ai/v1/realtime
```

Unlike OpenAI's Realtime API, the browser can't dial xAI directly:

- **`/v1/realtime/client_secrets` takes no `session` field.** The token carries
  no configuration, so a page dialling xAI directly would have to send its own
  `session.update` — putting the persona, the tool list and any MCP
  `authorization` header in client code.
- **The token lasts five minutes**, and conversations routinely outlive that.

So the socket lives here and the page holds no credential. On connect the proxy
sends `session.update` — persona, voice, turn detection, audio format, tools —
before forwarding anything the page queued.

What the page may send upstream is an allowlist: audio frames, a typed message,
a request to respond, a cancel, and the output of a function call it ran itself.
Two things are dropped as persona overrides — a `session.update` from the
browser, and the `instructions` field on a `response.create`.
`test/server/realtime.test.js` covers that.

One frame type never reaches xAI at all: `session.memory`, which the page sends
with what it has stored. The proxy folds those lines into the instructions and
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

## History

Every completed turn is written to `localStorage` under `rock.history.v1`, one
record per call, and the `log` button in the composer opens them newest first.
It is the only thing here that outlives the call: the session forgets a
conversation at teardown, and a redial starts one the new voice has no memory
of.

`new` starts a fresh conversation: it closes the record and, if a call is up,
dials again — the model's memory of what was said is the call itself, so a new
one is the only thing that clears it.

Nothing is uploaded. The log is in the browser that made the call, the proxy
never sees it, and `clear` — which asks once — removes it.

Storage is not assumed to work: private-mode Safari hands back a store that
throws on write, and the log falls back to memory for the life of the page
rather than failing the call. The last 40 conversations are kept, and the
oldest are shed to stay inside a 300 KB budget, since that space belongs to the
whole origin.

Old turns are not replayed into a new call. Reading them back to the model
would make the log a memory rather than a record, and `session.tools` has no
path for it that doesn't also let the page rewrite the persona.

## Tools

`web_search` and `x_search` are on by default. Both execute inside xAI, so
there's nothing to implement here and no second credential to hold. Rock is told
not to narrate a search; the only sign one is running is the label under the
status chip.

Remote MCP servers go in `XAI_MCP_SERVERS` as a JSON array, or in `mcp.json`
(gitignored), and are also executed by xAI:

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

Credentials there never leave the Node process — `/api/config` reports tool
labels only.

`remember` and `forget` are the two tools that run here rather than at xAI —
see below.

## Memory

The log is a record. Memory is the part Rock actually carries into the next
call: a short list of details, kept in `localStorage` under `rock.memory.v1`
and appended to the persona as a labelled block when the call opens.

Ask him to remember something and he calls `remember`; ask him to forget it and
he calls `forget`, which drops every stored line matching the keyword. Both run
in the page against browser storage, and the result goes back up as a
`function_call_output`. The `memory` button opens the list, where you can add a
line by hand, drop one, switch the whole thing off, or clear it.

The list is capped at 25 lines, each flattened to one line and cut at 600
characters. Past the cap the oldest goes. Editing the list during a call
re-sends `session.memory`, so a memory added mid-conversation is live in it;
switching memory off empties the block on the next `session.update` without
deleting anything.

Nothing is uploaded and nothing is shared between browsers — the proxy holds no
memory of its own, and `MEMORY=false` removes both the tools and the prompt
block entirely.

Memories are text the person typed or dictated, so they land inside the prompt.
They are flattened onto one line each and capped in `persona.js` before they get
there, which keeps a memory from opening a new instruction paragraph, and the
persona is always first in the string.

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
    history.js          Past conversations, in localStorage
    memory.js           What he remembers between calls, in localStorage
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
      tools.js            remember/forget, run in the page
      metering.js         An analyser → one 0..1 number per frame
      emitter.js
      constants.js        The wire format, shared with the server
    ui/
      hud.js              Status chip, transcript, caption, tool label
      history.js          The log panel behind the `log` button
      memory.js           The memory panel behind the `memory` button
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
.github/workflows/      CI (lint, tests, build smoke test) and the Docker publish
```

`src/client/boulder/` started as a single-file prototype (`boulder-buddy.html`),
still in the first commit. `src/client/vendor/three-d-stage.js` is a copied
starter component with two local changes, listed at the top of the file —
re-copying it drops them.

## The transport seam

`session/index.js` exposes `on`, `start`, `stop`, `send`, `cancel`, `syncMemory`,
`messages`, `connected`, `busy`, `stale`, `state`, `muted`, `model`, `voice` —
and emits:

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
