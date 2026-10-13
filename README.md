# Red Letter

Live co-editing and margin comments for markdown files in a GitHub repo. Git stays the source of truth: agents `git pull` / `git push`, and their commits show up in the browser as reviewable changes.

Open any file by swapping the host: `https://github.com/o/r/blob/main/x.md` → `https://diff.satanworker.com/o/r/blob/main/x.md`.

Design: [`docs/DESIGN.md`](docs/DESIGN.md). Spikes: [`experiments/RESULTS.md`](experiments/RESULTS.md).

## Layout

| path | what |
|---|---|
| `web/` | the app (TypeScript, CodeMirror 6, Automerge). Static, deployed as Cloudflare static assets |
| `server/` | Go hub: WebSocket room router for live sync + GitHub App OAuth code exchange. Holds no data |
| `deploy/` | systemd user units and the Cloudflare Tunnel config used on home-satan |

## Develop

```sh
cd web && bun install && bun dev.ts          # http://localhost:5173 (uses the hub on localhost:8787)
cd server && CGO_ENABLED=0 go test ./...
```

## Deploy

```sh
cd web && bun build.ts && bunx wrangler@4 deploy                     # diff.satanworker.com
cd server && CGO_ENABLED=0 go build -o ~/.config/red-letter/rl-hub . \
  && systemctl --user restart red-letter-hub                         # diff-api.satanworker.com
```

On home-satan the hub and `cloudflared` run as systemd user units (`deploy/*.service`, linger enabled). Secrets live outside the repo in `~/.config/red-letter/`: `env` (`RL_GITHUB_CLIENT_ID`, `RL_GITHUB_CLIENT_SECRET`, `RL_ORIGINS`, `RL_ADDR`), the App private key `app.pem` (unused so far), `tunnel.json` (tunnel credentials) and `tunnel.yml` (`deploy/tunnel.yml` with the tunnel id and home path filled in).

GitHub App: [`red-letter-diff`](https://github.com/apps/red-letter-diff). Permissions: contents and pull requests read/write, metadata read.
