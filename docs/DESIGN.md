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

## Topology (serverless)

![architecture](diagrams/architecture.svg)

Infra we run, all stateless, holding no user keys:

- static site
- sync relay (`automerge-repo` sync server, no storage)
- OAuth exchange/refresh function (holds the GitHub App `client_secret` only)

GitHub holds all state:

- `refs/heads/<branch>` — the file. Truth.
- `refs/red-letter/<branch>/<path>` — Automerge blob + the `commit_sha` it corresponds to. Doc identity and history.
- orphan branch `red-letter-comments` — comment JSON: cursor pair, context snippet, author, parent.

## Browser, per open file

1. Sign in: GitHub App user-to-server token (8h, refresh 6mo), kept in the browser only.
2. Load the CRDT ref. Absent → init from the file blob, `POST git/refs` to create it. 422 = someone else won; load theirs. Git is the lock.
3. Ref's `commit_sha` ≠ branch head → replay the diff at the recorded heads before showing.
4. Connect relay. Edit in CodeMirror 6. Replica in IndexedDB; offline works.
5. Poll `GET git/ref/heads/<branch>` with `If-None-Match` every ~15s (304s are free). Changed → replay at heads.
6. Idle 30s / explicit save: Git Data `blob → tree → commit → PATCH ref {force:false}`, then update the CRDT ref. 422 → poll, replay, retry.
7. Comments: cursors + ~50-char context, written to the orphan branch the same way. Render from cursors; fall back to context match if the doc identity was ever lost.

Agent: `git pull`, edit, `git push`. `git show red-letter-comments:…` to read comments. Nothing to install.

Draft = real branch: create branch + copy the CRDT ref (same doc identity). Publish = PR. Base sees the merge as an external push and replays it.

## The one hard primitive

Webhook/poll diff must be applied **at the last-committed version**, not against the live doc. The agent's blob is based on the last commit; diffing against the live doc would treat in-flight browser edits as agent deletions.

Automerge: `changeAt(headsAtLastCommit, d => updateText(d, ['text'], newBlob))`. Then concurrent browser ops merge normally.

## Decisions

| decision | pick | why |
|---|---|---|
| CRDT | Automerge 3.5 | `changeAt` + `updateText` is the primitive in one call; `getCursor` for anchors; `getAuthors` for `Co-authored-by`. Loro is the swap if a Rust-only server ever appears. Yjs: best ecosystem, no historical-edit primitive, default GC drops the history we key on. |
| Editor v1 | CodeMirror 6 `lang-markdown` + split preview bound to the Automerge text | every tree editor (Tiptap, Milkdown, Outline, GitBook, Tina) canonicalises or corrupts markdown on round-trip; agents would see diff noise. |
| Editor later | Obsidian-style live preview as decorations over the same string | never a ProseMirror tree as the CRDT doc |
| Comments | out of band, anchored by Automerge cursors + context | marks live in the doc and would serialise into the file |
| Auth | GitHub App, user-to-server tokens in the browser; no OAuth App, no PAT | native install screen, short-lived scoped tokens, orgs can approve. Token = installed repos ∩ user access. |
| Commit | Git Data API with CAS | atomic; `force:false` is the only safe write |
| Transport | websocket relay | WebRTC adds signalling/NAT pain for nothing; offline merge is a CRDT property, not a transport property |

## Known risks

- Myers diff ≠ keystrokes. Large batched `updateText` merges poorly with concurrent edits (Upwelling: `frosty`+`soft` → `frostysoft`). Show "agent changed this region"; humans review. `updateText` is Beta.
- Signed-commit branch protection rejects unsigned user-token API commits. Use draft branches; main gets bot-signed + `Co-authored-by` if needed.
- Secondary rate limit: ≤80 content-creating req/min, ≤500/h per token. A commit is ~8 calls (file + CRDT ref). Serialise, keep idle ≥30s.
- Doc identity: comment anchors are op IDs in one specific Automerge doc. Lose the doc, lose the anchors. Hence the ref and the context snippet.
- Agent→browser latency is the poll interval, not ~1s webhook.
- `@automerge/automerge-codemirror` is 0.2.0 vs `y-codemirror.next` at 171k/wk. Price of the right primitive.

## Spikes before UI

1. `changeAt(heads, updateText)` merge quality on realistic concurrent edits. Fallback: Loro `checkout` + `text.update`.
2. Browser-direct Git Data API: CORS, two-ref commit sequence, CAS retry, rate ceiling.
3. Custom refs `refs/red-letter/*` via API: creatable, readable, hidden from branches UI, survive clone/push.

## Research

`docs/research/` — five reports, 2026-10-12: prior art (Patchwork, Jupyter RTC, pushwork), CRDT comparison, markdown editors, existing products, GitHub integration mechanics.
