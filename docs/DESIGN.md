# Red Letter — design sketch

Share a link to a file in a GitHub repo. Anyone with access signs in with GitHub, reads it, edits it live with others, comments in the margin. Agents keep using plain git. The file stays vanilla markdown.

Red-letter Bibles print the important words in red on top of the plain text: an annotation layer over a canonical text. Same idea.

## Truth model

| | git | CRDT |
|---|---|---|
| unit | commit | op |
| merge | 3-way, manual | automatic |
| who | agents, CLI, CI | humans in browser |

Git is canonical. The CRDT is the live working copy of one file on one branch. Git conflicts become CRDT merges.

## Topology (no stateful server)

![architecture](diagrams/architecture.svg)

Infra we run, none of it a source of truth, none of it holding user keys:

- static site: `diff.satanworker.com`, served as Cloudflare Workers static assets (no Worker code; static requests are free). Chosen over R2 because it has a built-in SPA fallback, sets content types and honours a `_headers` file. Hashed `/assets/*` are `immutable`. The 3.6 MB `automerge.wasm` is a separate cacheable file rather than base64 inside the JS.
- `diff-api.satanworker.com`: one Go binary on home-satan, reached through a Cloudflare Tunnel (`cloudflared` dials out), so no inbound ports open. A first-level subdomain is required because Universal SSL doesn't cover `*.diff.satanworker.com`. Cloudflare drops idle WebSockets after 100 s, so the hub pings every 30 s.
  - sync hub: a dumb room router that doesn't know about CRDTs. Room = repo. Tabs mesh-sync through it, using our own ~80-line automerge-repo `NetworkAdapter` (multi-peer, routes by `targetId`). We can't use the stock websocket adapter: it assumes a single remote peer that is itself an automerge-repo server. The first message carries the GitHub token; the hub admits a tab only with push access to the room's repo (checked via the GitHub API, cached briefly). Read-only viewers get no live sync, because any sync peer can inject ops that a writer later commits. In-memory only. A tab alone has no peer; it loads from the snapshot ref.
  - `POST /oauth/token` and `/oauth/refresh`: exchanges the code using the GitHub App `client_secret` and returns tokens to the browser without storing them. CORS allows the site origin only.

GitHub's callback goes to the static site (`/auth/callback`). The page POSTs `{code, code_verifier}` to the VPS.

GitHub holds all state:

- `refs/heads/<branch>` — the file. Truth.
- `refs/red-letter/v1/<sha1(branch)>/<sha1(path)>` — parentless commit holding `doc.automerge` + `meta.json {docId, branch, path, commit, heads}`. Doc identity and history. Hashed names: `<branch>/<path>` collides and hits ref directory/file conflicts.
- orphan branch `red-letter-comments`: one JSON array per file at `<branch>/<path>.json` with cursor pair, quote, author and parent. Agents read it with `git show origin/red-letter-comments:<branch>/<path>.json` and can reply by pushing to it.

## Browser, per open file

1. Sign in: GitHub App user-to-server token (8h, refresh 6mo), kept in the browser only.
2. Load the snapshot ref. Absent → init from the file blob, `POST git/refs` to create it. 422 `Reference already exists` = someone else won; load theirs. Git is the lock.
3. Walk first-parent commits from branch head back to the doc's last known commit; replay each agent commit in order (see below). Browser commits carry a `Red-Letter-Heads:` trailer and are never replayed; if those heads are missing locally, merge the snapshot.
4. Connect relay. Edit in CodeMirror 6. Replica in IndexedDB; offline works. The CRDT holds LF; the committer restores the file's EOL.
5. Poll `GET git/ref/heads/<branch>` every ~15s with `cache:"no-store"` + manual `If-None-Match` (304s are free; default fetch serves refs from cache for 60s). Changed → step 3.
6. Idle 30s / explicit save: `POST trees` (inline content) → `POST commits` (trailer) → snapshot `blob → tree → commit` → GraphQL `updateRefs` moving branch + snapshot ref atomically with CAS. Any error → poll, replay, retry. (REST `PATCH` has no CAS on non-branch refs.) 7 calls, ~3–4s.
7. Comments: cursors + ~50-char context, written to the orphan branch. Render from cursors; fall back to context match if the doc identity was ever lost.

Agent: `git pull`, edit, `git push`. `git show red-letter-comments:…` to read comments. Nothing to install.

Draft = real branch: create branch + copy the CRDT ref (same doc identity). Publish = PR. Base sees the merge as an external push and replays it.

## The one hard primitive

Agent pushes are applied **at the heads of the parent commit**, not against the live doc; diffing against the live doc would treat in-flight browser edits as agent deletions.

Every open tab polls, so several tabs replay the same push. Replay must therefore be deterministic: fork at the recorded heads with actor `from[0:16] + to[0:16]`, `time: 0`, `updateText(newBlob)`, then `applyChanges` the resulting change. Identical change bytes on every tab → the CRDT dedupes. Replay every first-parent commit; skipping one produces a different change and duplicates text. Not `changeAt`: in automerge 3.5.0 its materialized text/patches are wrong ~half the time with concurrent edits. Code: `experiments/crdt/replay.ts`.

Where both sides touched the same words, the merge can interleave (`pheople`, `GitHHub`). `findConflicts` (`experiments/crdt/conflicts.ts`) flags exactly those regions; they are stored in the doc as cursor pairs keyed by commit sha and highlighted for review.

## Decisions

| decision | pick | why |
|---|---|---|
| CRDT | Automerge 3.5 | deterministic fork-at-heads replay (spiked: dedupes across tabs); `getCursor` for anchors; `getAuthors` for `Co-authored-by`. Loro char merges identically and is the swap if needed. Yjs: no historical-edit primitive, default GC drops the history we key on. |
| Editor | CodeMirror 6 with an Obsidian-style live preview (`web/src/livePreview.ts`): decorations over the raw markdown string; syntax markers hidden except on the cursor line | every tree editor (Tiptap, Milkdown, Outline, GitBook, Tina) canonicalises or corrupts markdown on round-trip; agents would see diff noise. Never a ProseMirror tree as the CRDT doc |
| Comments | out of band, anchored by Automerge cursors + context | marks live in the doc and would serialise into the file |
| Auth | Two options, both with tokens kept only in the browser. Default: classic OAuth App (`repo` scope, expiring tokens with refresh): one click, any repo the user can reach, nothing to install. Alternative: GitHub App user-to-server tokens, which see only repos where the App is installed | The OAuth App removes install friction when sharing links. The GitHub App suits people and orgs who want per-repo scoping. Orgs with OAuth access restrictions must approve the OAuth App. |
| Commit | Git Data API + GraphQL `updateRefs` | atomic file + snapshot move with real CAS on both refs |
| Transport | websocket relay | WebRTC adds signalling/NAT pain for nothing; offline merge is a CRDT property, not a transport property |

## Known risks

- Myers diff ≠ keystrokes: same-word edits interleave. Flagged and highlighted (see above); humans review. `updateText` is Beta.
- Signed-commit branch protection rejects unsigned user-token API commits. Use draft branches; main gets bot-signed + `Co-authored-by` if needed.
- Secondary rate limit: ≤80 content-creating req/min, ≤500/h per token. A save is 6 writes + reads. Serialise, keep idle ≥30s.
- Doc identity: comment anchors are op IDs in one specific Automerge doc. Lose the snapshot ref, lose the anchors; hence the context snippet. An agent's `git push --mirror` deletes `refs/red-letter/*`; a default clone doesn't fetch them.
- Agent→browser latency is the poll interval, not ~1s webhook.
- `@automerge/automerge-codemirror` is 0.2.0 vs `y-codemirror.next` at 171k/wk. Price of the right primitive. Works in the smoke test.
- `updateRefs` with a GitHub App user-to-server token: verified working in the prototype (autosave commits on `demo`).
- Replay determinism is a cross-version contract: change bytes depend on the Automerge version, the diff and the actor recipe. Mixed builds duplicate text (Jupyter's duplication bugs are this). Done: Automerge pinned to exactly 3.5.0, `replayVersion` in `meta.json`, and a tab refuses a snapshot from a newer version.
- The relay accepts ops from anyone holding a docId, and an honest tab later commits them under its own name. Done: the hub admits a tab only with push access to the repo.
- Replayed agent changes must stay off the human's undo stack. Done: remote transactions are marked `addToHistory: false`; verified that Ctrl-Z skips the agent's edit.

## Prototype status (updated 2026-10-13)

Live at `diff.satanworker.com`; code in `web/` and `server/`; run/deploy notes in `README.md`. Verified end to end with two tabs and a git-pushing "agent" on the `demo` branch of this repo.

Done:
- **Sign-in, two options** (tokens only in the browser; the hub exchanges codes and stores nothing):
  - Default "Continue with GitHub": OAuth App "Red Letter", `repo` scope, expiring tokens with refresh, nothing to install. Verified on localhost.
  - "Use the GitHub App instead": [`red-letter-diff`](https://github.com/apps/red-letter-diff), per-repo install. Its user token (8 h, with refresh) commits through `updateRefs`, which closed the last open risk from the spikes. A repo without the App routes the user to its install page.
- **Live sync and saving:** edits sync through the Go hub, one room per file (repo + branch + path) with presence avatars. Saves happen 30–40 s after the last edit or on Save / Ctrl-S.
- **Agent pushes:**
  - replayed into every open tab without duplicated text;
  - shown inline as insertions plus struck-through deletions;
  - announced by a banner over the document;
  - listed in a panel with per-change Revert and "Looks good";
  - where they interleave with a human edit, flagged with "Keep yours / Keep agent's".
  - Ctrl-Z never reverts an agent's or a peer's change.
- **Comments:**
  - written to `red-letter-comments`, started from a floating "Comment" button on a selection;
  - shown as threads with replies and resolve;
  - the agent read one via `git show` and replied by pushing;
  - the anchor followed the text through edits.
- **URLs and file browser:** `/owner/repo` opens the default branch's README with a sidebar listing the branch's markdown files (collapsible tree + filter); `/owner/repo/tree/<branch>`, `/owner/repo/blob/<branch>/<path>` (GitHub's shape) and `/owner/repo/<path>` (default branch) all work. Missing files show the sidebar with a not-found note.
- **UI:** Notion-style live-preview editor: centered column; headings, emphasis, lists, checkboxes, quotes, code and images rendered inline; markdown syntax shown only on the cursor line. Breadcrumb header with branch pill, save state and Share.
- **Infra:**
  - static site on Cloudflare (Workers static assets);
  - Go hub + OAuth exchange on home-satan as systemd user units behind a Cloudflare Tunnel (`diff-api.satanworker.com`);
  - secrets in `~/.config/red-letter/`.

Not built yet:
- IndexedDB replica (offline across reloads);
- presence cursors inside the text (avatars only today);
- notifications and mentions;
- draft branches / publish as PR;
- read-only viewing without signing in;
- tables rendered in the editor (shown as raw markdown).

Open items:
- Deployment lives in systemd user units, not home-satan's NixOS config. Moving it there needs the sops key.
- home-satan has no outbound IPv6. It doesn't affect Red Letter; enabling it (static `/64` + `fe80::1` gateway in `hosts/hetzner`) is optional.
- Visual design is a first pass; a reference page or Figma would let us match a target.

## Spikes

Done 2026-10-12, all passing: `experiments/RESULTS.md` (merge quality, deterministic replay, anchors, perf, GitHub API in `experiments/github/FINDINGS.md`, full browser loop in `experiments/browser/`).

## Research

`docs/research/` — five reports, 2026-10-12: prior art (Patchwork, Jupyter RTC, pushwork), CRDT comparison, markdown editors, existing products, GitHub integration mechanics. Plus `crdts-in-production.md`, 2026-10-13: Notion, Zed, Figma, Linear, Liveblocks and others, agent-editing patterns, and file→CRDT bridges compared with our replay.
