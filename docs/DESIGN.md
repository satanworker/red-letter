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

- static site: `diff.satanworker.com` on R2 (dedicated public bucket + custom domain; no egress fees for the ~3.6 MB wasm). Hashed assets are `immutable`; `index.html` is `no-cache`; `.wasm` is uploaded as `application/wasm`. Deep links need a Cloudflare URL-rewrite rule to `/index.html`, since R2 has no SPA fallback.
- `diff-api.satanworker.com`: one Go binary on home-satan, reached through a Cloudflare Tunnel (`cloudflared` dials out), so no inbound ports open. A first-level subdomain is required because Universal SSL doesn't cover `*.diff.satanworker.com`. Cloudflare drops idle WebSockets after 100 s, so the hub pings every 30 s.
  - sync hub: a dumb room router that doesn't know about CRDTs. Room = repo. Tabs mesh-sync through it, using our own ~80-line automerge-repo `NetworkAdapter` (multi-peer, routes by `targetId`). We can't use the stock websocket adapter: it assumes a single remote peer that is itself an automerge-repo server. The first message carries the GitHub token; the hub admits a tab only with push access to the room's repo (checked via the GitHub API, cached briefly). Read-only viewers get no live sync, because any sync peer can inject ops that a writer later commits. In-memory only. A tab alone has no peer; it loads from the snapshot ref.
  - `POST /oauth/token` and `/oauth/refresh`: exchanges the code using the GitHub App `client_secret` and returns tokens to the browser without storing them. CORS allows the site origin only.

GitHub's callback goes to the static site (`/auth/callback`). The page POSTs `{code, code_verifier}` to the VPS.

GitHub holds all state:

- `refs/heads/<branch>` — the file. Truth.
- `refs/red-letter/v1/<sha1(branch)>/<sha1(path)>` — parentless commit holding `doc.automerge` + `meta.json {docId, branch, path, commit, heads}`. Doc identity and history. Hashed names: `<branch>/<path>` collides and hits ref directory/file conflicts.
- orphan branch `red-letter-comments` — comment JSON: cursor pair, context snippet, author, parent.

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
| Editor v1 | CodeMirror 6 `lang-markdown` + split preview bound to the Automerge text | every tree editor (Tiptap, Milkdown, Outline, GitBook, Tina) canonicalises or corrupts markdown on round-trip; agents would see diff noise. |
| Editor later | Obsidian-style live preview as decorations over the same string | never a ProseMirror tree as the CRDT doc |
| Comments | out of band, anchored by Automerge cursors + context | marks live in the doc and would serialise into the file |
| Auth | GitHub App, user-to-server tokens in the browser; no OAuth App, no PAT | native install screen, short-lived scoped tokens, orgs can approve. Token = installed repos ∩ user access. |
| Commit | Git Data API + GraphQL `updateRefs` | atomic file + snapshot move with real CAS on both refs |
| Transport | websocket relay | WebRTC adds signalling/NAT pain for nothing; offline merge is a CRDT property, not a transport property |

## Known risks

- Myers diff ≠ keystrokes: same-word edits interleave. Flagged and highlighted (see above); humans review. `updateText` is Beta.
- Signed-commit branch protection rejects unsigned user-token API commits. Use draft branches; main gets bot-signed + `Co-authored-by` if needed.
- Secondary rate limit: ≤80 content-creating req/min, ≤500/h per token. A save is 6 writes + reads. Serialise, keep idle ≥30s.
- Doc identity: comment anchors are op IDs in one specific Automerge doc. Lose the snapshot ref, lose the anchors; hence the context snippet. An agent's `git push --mirror` deletes `refs/red-letter/*`; a default clone doesn't fetch them.
- Agent→browser latency is the poll interval, not ~1s webhook.
- `@automerge/automerge-codemirror` is 0.2.0 vs `y-codemirror.next` at 171k/wk. Price of the right primitive. Works in the smoke test.
- `updateRefs` with a GitHub App user-to-server token is untested (spikes used a PAT). Verify first.
- Replay determinism is a cross-version contract: change bytes depend on the Automerge version, the diff and the actor recipe. Mixed builds duplicate text (Jupyter's duplication bugs are this). Pin Automerge exactly; put `replayVersion` in `meta.json` and the trailer, and reload instead of replaying on mismatch.
- The relay accepts ops from anyone holding a docId, and an honest tab later commits them under its own name. The relay must check the GitHub token's repo access on connect (still stateless).
- Replayed agent changes must stay off the human's undo stack; one Ctrl-Z must not revert an agent commit.

## Spikes

Done 2026-10-12, all passing: `experiments/RESULTS.md` (merge quality, deterministic replay, anchors, perf, GitHub API in `experiments/github/FINDINGS.md`, full browser loop in `experiments/browser/`).

## Research

`docs/research/` — five reports, 2026-10-12: prior art (Patchwork, Jupyter RTC, pushwork), CRDT comparison, markdown editors, existing products, GitHub integration mechanics. Plus `crdts-in-production.md`, 2026-10-13: Notion, Zed, Figma, Linear, Liveblocks and others, agent-editing patterns, and file→CRDT bridges compared with our replay.
