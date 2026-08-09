# Configuration

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
| `CONNECTORS` | — | Agents Rock may hand work to: `openclaw`. Off unless named. See [connectors](connectors.md). |
| `PORT` | `5173` | |
| `HOST` | `127.0.0.1` | Which interface to bind. This machine only unless you say otherwise, or `npm start` is serving TLS. |
| `SSL_KEY`, `SSL_CERT` | — | Paths to a real certificate; `npm start` then serves HTTPS |

## On a phone

```sh
npm run dev:lan           # → https://192.168.x.x:5173, printed on start
```

Microphone access needs a secure context. `localhost` is one; a LAN address over
plain HTTP is not — `navigator.mediaDevices` doesn't exist there, so the page
can't even raise the mic prompt. The `:lan` scripts serve HTTPS with a
self-signed certificate, cached in `node_modules/.vite/`, and the realtime
socket follows the page onto `wss:`.

No browser trusts that certificate, so the phone shows a warning the first time
("Advanced" → proceed on Chrome, "Show details" → "visit this website" on
Safari). Tap through it once per device. To skip it, point `SSL_KEY` and
`SSL_CERT` at a certificate the device already trusts —
[mkcert](https://github.com/FiloSottile/mkcert) issues one for a LAN IP.

## Docker

```sh
docker run --rm -p 5173:5173 -e XAI_API_KEY=xai-... h1ddenpr0cess20/rock
```

Images go to Docker Hub on every push to `main` (`latest`) and on `v*` tags
(`1.2.3`, `1.2`), for `linux/amd64` and `linux/arm64`. Configuration is the same
set of variables as `.env` — pass them with `-e` or `--env-file .env`.

The container serves HTTP on `PORT` and expects TLS to be terminated in front of
it; to serve TLS from the container, mount a certificate and set `SSL_KEY` and
`SSL_CERT`. Build it yourself with `docker build -t rock .`. Publishing from a
fork needs a `DOCKERHUB_TOKEN` secret, plus a `DOCKERHUB_USERNAME` variable if
your Docker Hub account isn't `h1ddenpr0cess20`.

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
labels only. `remember` and `forget` are the two tools that run in the page
rather than at xAI.

`dispatch_task`, `check_task` and `cancel_task` are the three that run here, in
the proxy, and they only exist once a connector is switched on. That is an agent
CLI on this machine, editing real files, so it has a panel and a page of its own
— see [connectors](connectors.md).

### Switching one off for a call

`tools` opens a switch for each tool this server offers — web search, X search,
and one per MCP server. Switching one off takes it out of the call that is up
right now: the proxy re-declares the tools with `session.update`, so there is no
redial and nothing to reconnect. The switches live in `localStorage`, so they
hold across calls and reloads in that browser.

The connectors are not in that panel. An agent that edits files on this machine
is switched on against the server, for everyone it serves, rather than per
browser — so it lives in the `connectors` tab instead.

The page can only take away. What exists is the environment's to say, and a tool
`XAI_WEB_SEARCH=false` never enabled has no switch to find — a browser asking
for one gets nothing, because the proxy checks every name against its own list
before it drops anything. Memory is the exception, and only because it already
had a switch of its own, in the `memory` panel.

## The log and the memory

`log` opens past conversations, newest first. `new` closes the record and, if a
call is up, dials again — the model's memory of what was said is the call
itself, so a new call is the only thing that clears it. `clear` asks once, then
removes the log.

`memory` opens the short list of details Rock carries between calls. Ask him to
remember something and he calls `remember`; ask him to forget it and he calls
`forget`, which drops every stored line matching the keyword. You can also add a
line by hand, drop one, switch the whole thing off, or clear it. `MEMORY=false`
removes the tools and the prompt block for everyone the server serves.

Both live in `localStorage`, in the browser that made the call. Nothing is
uploaded, and the proxy keeps no copy of either — see the
[design notes](design.md#storage) for the caps and the wire format.
