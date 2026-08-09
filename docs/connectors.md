# Connectors

A connector is an agent this server may hand a task to. One is wired:

| | Run as |
|---|---|
| **OpenClaw** | `openclaw agent exec <task> --json --timeout 0 --cwd <workspace> --isolated` |

It is off until you switch it on, because it edits files on the machine the
server is running on. That happens in the **connectors** panel, not in a file:

```
connectors                                    save   close
  workspace  /home/you/the-repo    at once 3    time limit 900

  [on ] OpenClaw                                    openclaw
        mode isolated   model —   workspace —
```

Switch it on, point the workspace at the repo you want worked on, pick how much
it is allowed to do, and save. It takes effect on the running server — mid call,
without a redial — and is written to `connectors.json` (gitignored), so the next
boot opens the same way. An agent that is on appears in the picker next to the
voice, which is what a hand-off defaults to when the model doesn't name one
itself.

The CLI has to be installed and already logged in — Rock holds no credential for
it and hands it none. The `XAI_API_KEY` is stripped out of the environment the
agent inherits; it is ours, and it has no use for it.

## The work

Say what you want done. Rock writes the task up, reads it back, and hands it
over on a yes. `dispatch_task` returns a number as soon as the process is
spawned — the agent keeps working and the call carries on. When it settles, Rock
says so, in a sentence, without being asked. `check_task` is the model asking
where one stands; `cancel_task` stops one, and Rock will tell you that what it
already wrote is still written.

The same panel is where the work shows up: every task, newest first, with the
directory it is running in, what it was asked to do, how long it has been going,
what the agent said at the end, and a `stop` button while it is still running.
The tab counts what is in flight.

What the agent sends back also lands in the **log**, beside the conversation
that handed it over — labelled with the agent and the task number, the task
above it, the whole reply below. That is the copy you can read at leisure: what
Rock says out loud is a sentence about it.

The tasks belong to the server, not to the call. Changing voice mid-session
redials, and the new call opens knowing what was handed over before it — running
or finished — because that recap goes into the session prompt.

None of it touches the page. The proxy answers those three tools itself: the
browser never learns what command was run, and only ever sees a status. The
model doesn't see the command line either, or the agent's raw output beyond the
summary it printed at the end.

## The two modes

`openclaw agent exec` is OpenClaw's headless entry point: one embedded turn, no
gateway, a temporary state directory it makes and removes itself, and a JSON
envelope on stdout at the end. The mode in the panel picks where that run reads
its setup from:

| | |
|---|---|
| `isolated` | The ambient OpenClaw config is ignored and only exec's own defaults apply: the coding tool profile, no workspace bootstrap, and filesystem tools restricted to the workspace we hand it. This is what it is switched on as. |
| `ambient` | The machine's own OpenClaw config — its providers, plugins, channels and sandbox settings — which wins over those defaults wherever it sets something. The panel says so in red, because that config is not something the panel can see. |

Its own `--timeout` is set to `0`, which turns off the ten-minute deadline
`agent exec` would otherwise impose. The time limit that counts is the
connector's: the one in the panel, which is also the one that actually kills the
process. Put OpenClaw's back with `OPENCLAW_ARGS=--timeout 600` if you want both.

A run uses stored credentials by default, so it reaches the same logins as the
rest of your OpenClaw install. `OPENCLAW_ARGS=--auth-env-only` narrows that to
provider keys already in the environment.

The envelope is read for `final`, falling back to the last of `payloads`, and a
`status` that isn't `ok` — or an `ok: false` — is a failure carrying
`error.message`. If none of that is there, the tail of what was actually printed
rides back instead of the task failing over a renamed field. A non-zero exit is
a failure too, and the last of stderr comes with it.

The workspace is resolved once, when the task is handed over, and recorded on
the task itself — the panel and the log show where it ran rather than leaving
you to ask the agent, which answers from inside whatever sandbox it runs in. It
is handed over as `--cwd` rather than by inheritance, and `PWD` is rewritten in
the child's environment, which `spawn` does not do on its own.

Rock is told, in the prompt, that this edits real files: read the task back
before handing it over, get a plain yes for anything that doesn't come back, and
never claim work happened that he hasn't checked on.

## From the environment

`.env` sets the defaults for a fresh machine — `CONNECTORS=openclaw` starts with
it on — and owns the two things the panel deliberately cannot touch:

| | |
|---|---|
| `OPENCLAW_COMMAND` | **Panel-proof.** A whole command line, so the CLI can be wrapped — `npx openclaw`, `docker exec -w /work dev openclaw`. The flags above are appended to it. Which binary this server executes is not something a browser gets to choose. |
| `OPENCLAW_ARGS` | Anything else, split like a shell would. Also panel-proof, and appended last, so a flag here beats the one we set. |
| `CONNECTOR_FILE` | Where the panel saves. `connectors.json` by default. |
| `OPENCLAW_MODEL` | Starting value for the model field. `provider/model`, e.g. `openai/gpt-5.6-sol`. |
| `OPENCLAW_MODE` | `isolated` (default) or `ambient`. |
| `OPENCLAW_CWD` | A different workspace for this one agent. |
| `CONNECTOR_CWD` | Where they all work. Where the server was started, by default. |
| `CONNECTOR_TIMEOUT` | Seconds one may run before it is stopped. 900 by default. |
| `CONNECTOR_LIMIT` | How many may run at once. 3 by default. |
| `CONNECTOR_ANNOUNCE` | Whether Rock says so when a task settles. |

**Anyone who can reach the page can spend your agent's tokens on your files.**
Rock has no accounts and no auth, so who can reach it is the whole control:

- `npm start` and `npm run dev` bind to `127.0.0.1` unless `HOST` says
  otherwise, or `npm start` is serving TLS — which is the phone case, and the
  network by definition. `npm run dev:lan` passes `--host`, which is that
  decision made on purpose.
- Reaching it is not the same as being it. The connector API refuses anything
  that changes a setting if the browser says it came from another page, and the
  realtime socket refuses the handshake outright. Without that second check a
  page in an unrelated tab could open the call — WebSockets are outside the
  same-origin policy — put a sentence in your mouth and get an agent spawned on
  your files. Requests with no `Origin` at all are left alone: that is not a
  browser, and anything already running here needs no help from one.
- What is left is the network you put it on. On a LAN, everyone on it can reach
  the page, and the page is the whole authorisation story.

## In Docker

The connector is not usable in the published image: the OpenClaw CLI isn't in
it, and neither is your workspace. Running it from a container means an image of
your own with the CLI installed, the repo mounted at `CONNECTOR_CWD`, and
whatever OpenClaw reads its credentials from mounted too.
