# Red Letter

Live co-editing and margin comments for markdown files in a GitHub repo. Git stays the source of truth: agents `git pull` / `git push`, and their commits show up in the browser as reviewable changes.

Open any file by swapping the host: `https://github.com/o/r/blob/main/x.md` → `https://diff.satanworker.com/o/r/blob/main/x.md`.

Design: [`docs/DESIGN.md`](docs/DESIGN.md). Spikes: [`experiments/RESULTS.md`](experiments/RESULTS.md).

## Layout

| path | what |
|---|---|
| `web/` | the app (TypeScript, Solid, CodeMirror 6, Automerge). Static, deployed as Cloudflare static assets plus a service worker |
| `server/` | Go hub: WebSocket room router for live sync + GitHub App OAuth code exchange. Holds no data |
| `deploy/` | systemd user units and the Cloudflare Tunnel config used on home-satan |

## Develop

```sh
cd web && bun install && bun dev.ts          # http://localhost:5173, PORT=… to change (uses the hub on localhost:8787)
cd server && RL_ORIGINS=http://localhost:5173 go run .                  # the hub, allowing the dev origin
cd web && bunx tsc -p . && bunx tsc -p tsconfig.sw.json                 # typecheck app + service worker
cd server && CGO_ENABLED=0 go test ./...
```

`bun dev.ts` rebuilds on changes under `web/src/`; after editing `index.html` or `build.ts`, run `bun build.ts`.

Styling is Tailwind v4: utility classes in the components, design tokens in `web/src/app.css`.

**Figma check:** `/__figma` (dev server only) shows the editor with the exact content of the Figma frame "Red Letter" › Desktop - 1 (node `1:8`) and lays the Figma render over it. Size the browser window to 1440 px wide; Alt+O toggles the overlay, Alt+D switches difference blend / 50% fade. The renders are in `web/dev/` (frame at 1024 px wide scaled up, doc column, sidebar and panel at 1×), exported with the Figma MCP server's `get_screenshot`.

## Deploy

Pushes to `main` that touch `web/` deploy the site automatically (`.github/workflows/deploy-web.yml`; needs the repo secret `CLOUDFLARE_API_TOKEN`, a token with the "Edit Cloudflare Workers" template). Manual equivalents:

```sh
cd web && bun build.ts && bunx wrangler@4 deploy                     # diff.satanworker.com
cd server && CGO_ENABLED=0 go build -o ~/.config/red-letter/rl-hub . \
  && systemctl --user restart red-letter-hub                         # diff-api.satanworker.com
```

On home-satan the hub and `cloudflared` run as systemd user units (`deploy/*.service`, linger enabled). Secrets live outside the repo in `~/.config/red-letter/`: `env` (`RL_GITHUB_CLIENT_ID`, `RL_GITHUB_CLIENT_SECRET`, `RL_ORIGINS`, `RL_ADDR`), the App private key `app.pem` (unused so far), `tunnel.json` (tunnel credentials) and `tunnel.yml` (`deploy/tunnel.yml` with the tunnel id and home path filled in).

Sign-in: OAuth App "Red Letter" (`repo` scope, default, nothing to install) or GitHub App [`red-letter-diff`](https://github.com/apps/red-letter-diff) (per-repo install; contents + pull requests read/write). The hub needs `RL_OAUTH_CLIENT_ID` / `RL_OAUTH_CLIENT_SECRET` in `env` for the former.
