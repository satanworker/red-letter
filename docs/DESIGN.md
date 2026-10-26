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

## Drafts

Live editing stays the default; a draft is opt-in, for work you don't want to do in public (Ink & Switch's "fishbowl effect", `docs/research/drafts.md`). A draft is a real branch, `drafts/<login>/<name>`, forked where the file was last saved, and live inside like any branch. Its doc is a fresh one made from the file at the fork (the CRDT ref isn't copied: nothing needs the shared identity yet). It records `base = {branch, commit, heads, inGit}`: the base branch's last commit merged into the draft, the doc heads where the text is exactly that commit's, and the last of those commits that git knows about as a merge parent.

- **Update from main** (shown when the base moved, never automatic): the base head's text is replayed at `base.heads`, exactly like an agent push, so main's edits and the draft's merge by character and overlaps are flagged for review. Then the draft saves it as a merge commit: parents `[draft head, base head]`, tree = the base's tree with this file's merged text. A draft that changed other files is refused (merge it on GitHub).
- **Changes**: the draft's diff from `base.heads` to now, drawn inline.
- **Merge into main**: update first; if main had moved, stop and let the writer review, so what lands is what was reviewed. Otherwise one `updateRefs`: the base branch moves to a merge commit with the draft's tree, and the draft branch and its snapshot ref are deleted, with CAS on all three. Base tabs see an external push and replay it.
- Drafts are listed in the branch picker for everyone who can read the repo. GitHub can't hide a branch, so "private" means "not announced", not access control.

## The one hard primitive

Agent pushes are applied **at the heads of the parent commit**, not against the live doc; diffing against the live doc would treat in-flight browser edits as agent deletions.

Every open tab polls, so several tabs replay the same push. Replay must therefore be deterministic: fork at the recorded heads with actor `from[0:16] + to[0:16]`, `time: 0`, `updateText(newBlob)`, then `applyChanges` the resulting change. Identical change bytes on every tab → the CRDT dedupes. Replay every first-parent commit; skipping one produces a different change and duplicates text. Not `changeAt`: in automerge 3.5.0 its materialized text/patches are wrong ~half the time with concurrent edits. Code: `experiments/crdt/replay.ts`.

Where both sides touched the same words, the merge can interleave (`pheople`, `GitHHub`). `findConflicts` (`experiments/crdt/conflicts.ts`) flags exactly those regions; they are stored in the doc as cursor pairs keyed by commit sha and highlighted for review.

## Decisions

| decision | pick | why |
|---|---|---|
| CRDT | Automerge 3.5 | deterministic fork-at-heads replay (spiked: dedupes across tabs); `getCursor` for anchors; `getAuthors` for `Co-authored-by`. Loro char merges identically and is the swap if needed. Yjs: no historical-edit primitive, default GC drops the history we key on. |
| Editor | CodeMirror 6 with an Obsidian-style live preview (`web/src/doc/livePreview.ts`): decorations over the raw markdown string; syntax markers hidden except on the cursor line | every tree editor (Tiptap, Milkdown, Outline, GitBook, Tina) canonicalises or corrupts markdown on round-trip; agents would see diff noise. Never a ProseMirror tree as the CRDT doc |
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

## Prototype status (updated 2026-10-25)

Live at `diff.satanworker.com`; code in `web/` and `server/`; run/deploy notes in `README.md`. Verified end to end with two tabs and a git-pushing "agent" on the `demo` branch of this repo.

Done:
- **Sign-in, two options** (tokens only in the browser; the hub exchanges codes and stores nothing):
  - Default "Continue with GitHub": OAuth App "Red Letter", `repo` scope, expiring tokens with refresh, nothing to install. Verified on localhost.
  - "Use the GitHub App instead": [`red-letter-diff`](https://github.com/apps/red-letter-diff), per-repo install. Its user token (8 h, with refresh) commits through `updateRefs`, which closed the last open risk from the spikes. A repo without the App routes the user to its install page.
- **Live sync and saving:** edits sync through the Go hub, one room per file (repo + branch + path) with presence avatars. Saves happen 30–40 s after the last edit or on Save / Ctrl-S.
- **Agent pushes:**
  - replayed into every open tab without duplicated text;
  - shown inline as insertions plus struck-through deletions;
  - counted on the History tab (the banner over the document is gone);
  - reviewed in the History tab: the file's commits on the branch as a timeline (newest first, last 50, each linked to GitHub; merges hollow, commits awaiting review red), where an agent commit not yet reviewed opens into per-change Revert and "Looks good";
  - where they interleave with a human edit, flagged with "Keep yours / Keep agent's".
  - Ctrl-Z never reverts an agent's or a peer's change.
  - a Red Letter save of *another* file on the branch is replayed (a no-op here) instead of stalling the walk: its trailer's heads belong to that file's doc.
- **Drafts** (see Drafts above; branch `drafts` / worktree `red-letter-drafts`): the branch picker in the header lists the base branch and every `drafts/*` branch and has "+ New draft…". Inside a draft a bar over the doc offers Changes, "Update from <base>" (when the base moved) and "Merge into <base>". Verified on `demo` with a scratch file: draft edits plus a concurrent agent push to `demo` (one overlapping word) → Update merged both and flagged the overlap → the agent pushed again → Merge pulled that in and stopped for review → Merge again landed one merge commit on `demo` that touched only the drafted file, deleted the draft branch and its snapshot ref, and the `demo` tab replayed it as a reviewable change.
- **Comments** (optimistic: shown at once, written to git in the background in order; pending writes and the last list are kept in IndexedDB, so they survive reloads and offline and go out when the network is back):
  - written to `red-letter-comments`, started from the "Add a comment" pill on a selection, which turns into the comment box in place (Enter sends, Esc cancels); the thread shows in the side panel only once sent (Figma `22:561`);
  - `@` in a comment or reply lists the repo's collaborators with their avatars (`GET /repos/{repo}/collaborators`, first 100); bodies keep plain `@login` text, as on GitHub, shown as chips. No notifications yet;
  - shown as threads with replies and resolve;
  - the agent read one via `git show` and replied by pushing;
  - the anchor followed the text through edits.
- **URLs and file browser:** `/owner/repo` opens the default branch's README with a sidebar listing the branch's markdown files (collapsible tree + filter); `/owner/repo/tree/<branch>`, `/owner/repo/blob/<branch>/<path>` (GitHub's shape) and `/owner/repo/<path>` (default branch) all work. Missing files show the sidebar with a not-found note. "+" in the sidebar (writers only) creates a markdown file, prefilled with the open file's folder (`.md` added if no extension): it joins the list and opens at once with a `# Title` line, and the file and its snapshot are committed by a background save (one `updateRefs`, which also creates the snapshot ref).
- **UI:** Notion-style live-preview editor: a centred column up to 780 px wide; headings, emphasis, lists (wrapped lines and Shift-Enter continuations align with the item's text), quotes, code and images styled inline. Markdown syntax always shows, muted, so moving the cursor never reflows the text: heading marks (`## `) hang in the left margin at body size, list markers stay as typed, a task's `[ ]` toggles on click. GFM tables are edited Obsidian-style (`web/src/doc/tables.ts`): cells are edited in place (the focused cell shows its raw markdown), Tab / Shift-Tab / Enter move between cells and add a row past the end, arrows and Escape leave the table, right-click inserts or deletes rows and columns, Ctrl-Z/Y go to the editor's history. A cell edit writes only the changed characters of that cell. Breadcrumb header with branch pill, save state and Share. Built with Solid 1.9 (compiled by `@dschz/bun-plugin-solid` under `bun build`); state lives in per-feature stores (`repoStore`, `docStore`, `commentsStore`), components only render and call actions.
- **Wide blocks:** tables and diagrams stay in the text column: a wide table wraps its cells (whole words), then scrolls.
- **Visual design:** follows the Figma file "Red Letter" (frame `Desktop - 1`, node `1:8`; comment flow `22:561`): Google Sans Code throughout (12 px on 15 px lines, H1 28 / H2 20 Medium), Grandstander logo, greys Onyx `#373737` / Middle `#EBEBEB` / Dark `#D8D8D8` / Shadows `#ADADAD`, one shared button shadow, 320 px file sidebar and panel around a flexible doc column holding a centred editor of at most 780 px with 30 px side padding (Figma's 440 px text column was dropped). Styling is Tailwind v4 (`web/src/app.css` holds the tokens as CSS variables, which CodeMirror's themes share; `bun-plugin-tailwind` in `build.ts`). Icons are the SVGs exported from Figma (`web/src/icons/`), inverted in dark mode. Fonts load from Google Fonts. The side panel is always open while a file is: the chosen tab is white with its label, the other a grey icon + count pill; History replaced Figma's Agent changes tab. Images (`![alt](path)`) show under their markdown line, repo-relative paths read from GitHub. Checked against Figma on `/__figma` (README).
- **Keyboard:** every control is a button or link with a visible focus ring; Up/Down walk the file tree; Left/Right switch the panel tabs; Esc closes every input; ⌘⌥M / Ctrl+Alt+M comments on the selection. ⌘K / Ctrl+K opens a palette of files and actions (comment, show comments / history, show or hide files, copy link). In the editor, Tab indents: Esc then Tab leaves it (CodeMirror's tab focus mode).
- **Comments on table cells:** text selected in the focused cell maps to doc positions (`cellSelection` in `tables.ts`); the "Add a comment" pill sits on it and the comment anchors to those characters.
- **Mermaid:** ` ```mermaid ` blocks render as SVG diagrams (`web/src/doc/mermaid.ts`) under their source, which always shows like any code block; while typing, the last picture stays until the new one has loaded, and a source that doesn't parse fades it (the error is its tooltip). Renderer lukilabs `beautiful-mermaid` 1.1 (ELK layout, no DOM): lazy chunk of 1.6 MB (470 KB gzipped), 20–70 ms a diagram, cached per source. `@vercel/beautiful-mermaid` (45 KB gzipped, ~5 ms) shipped first and was dropped: it showed the quotes of `A["label"]`, ignored `<br/>` and drew back edges outside the picture. mermaid.js is 1.5 MB gzipped and needs the DOM; Selkie (Rust/WASM, ~725 KB gzipped) isn't on npm.
- **Dark mode:** follows the system (`prefers-color-scheme`); every colour is a CSS variable in `web/src/app.css`, the editor themes use them too. Diagrams are `<img>`s carrying their own dark-scheme media query.
- **Code highlighting:** fenced code blocks get syntax colours from Pierre's `@pierre/highlights` (hand-written WebAssembly; tokenizing is ~0.3 ms per 1,000 lines) with the Pierre light/dark themes combined through CSS `light-dark()` (`web/src/doc/highlight.ts`). Loaded on the first code block (267 KB chunk, wasm inlined); tokens are cached per block, so only the block being typed in is re-tokenized.
- **No page reloads:** links, back/forward and the landing form go through the Navigation API; switching files keeps the page, the sign-in and the file list, and swaps only the doc (the old file leaves live sync at once). Browsers without the Navigation API get page loads.
- **Browser storage** (one IndexedDB database, `red-letter`; everything in it is a copy, GitHub stays the source of truth):
  - `docs`: each opened doc, saved at most once a second. A file reopens from it at once, then merges the snapshot if someone saved since and replays agent commits. Text edited offline survives reloads and goes to git when the connection is back (verified: offline edit → offline reload → online → saved).
  - `http`: GitHub GET responses. Sha-addressed ones (commits, trees, blobs, file contents at a sha) are never refetched; the rest revalidate with ETags and are used as-is offline.
  - Safari can drop the connection: every operation reopens once and retries; without IndexedDB the app runs as before, from the network. `navigator.storage.persist()` is requested after the first file opens. Sign-out clears both stores.
- **Service worker** (`web/src/sw.ts`): precaches this build's hashed assets (the 3.6 MB Automerge wasm included), serves them from the cache, and fetches pages network-first with the cached shell as the offline fallback. A repo opened before loads fully offline.
- **Background sync:** after a repo opens, every doc of the branch (snapshot merged into this browser's copy) and its comments are fetched, four at a time, pausing while a file opens. Any file then opens from the copy (measured: 200 ms to switch, ~0.7 s for a reload).
- **Network:** first paint never waits on GitHub (repo info, branch, file list and App install checks come from this browser's copy and revalidate behind it); concurrent reads of one URL share a request, and reads within 2 s share the answer; compare-and-swap paths (saves, comment writes, lost races) always ask GitHub.
- **Infra:**
  - static site on Cloudflare (Workers static assets);
  - Go hub + OAuth exchange on home-satan as systemd user units behind a Cloudflare Tunnel (`diff-api.satanworker.com`);
  - secrets in `~/.config/red-letter/`.

Not built yet:
- automerge-repo's incremental IndexedDB adapter instead of whole-doc saves, if docs get large;
- BroadcastChannel between tabs: skipped, the hub already syncs tabs on the same file, and adding a second adapter would announce the same peer twice;
- strip the wasm's 687 KB name section (−19% raw, −6% brotli);
- presence cursors inside the text (avatars only today);
- notifications for mentions;
- drafts: publish as a PR instead of merging in-app; retroactive drafts (move unsaved edits off main into a new draft); comments carried across a merge; tabs still open on a merged draft get save errors (the branch is gone); a base commit merged into a draft outside Red Letter isn't recorded in `base`, so the next Update would duplicate its text;
- read-only viewing without signing in;
- git authors (agents) get a GitHub avatar by name, which can be a stranger's account; show an initial instead.
- tables: agent-change and comment highlights inside a table aren't shown (the table is one widget); after some undos the caret leaves the table; no column resizing or drag to reorder.
- mermaid: a node first referenced bare and defined later keeps its id as label (`a --> lake` then `lake[(Lake)]` shows "lake"); diagrams wider than the breakout render at ≥70% and scroll; fences inside lists or quotes stay code.

Open items:
- Deployment lives in systemd user units, not home-satan's NixOS config. Moving it there needs the sops key.
- home-satan has no outbound IPv6. It doesn't affect Red Letter; enabling it (static `/64` + `fe80::1` gateway in `hosts/hetzner`) is optional.

## Spikes

Done 2026-10-12, all passing: `experiments/RESULTS.md` (merge quality, deterministic replay, anchors, perf, GitHub API in `experiments/github/FINDINGS.md`, full browser loop in `experiments/browser/`).

## Research

`docs/research/` — five reports, 2026-10-12: prior art (Patchwork, Jupyter RTC, pushwork), CRDT comparison, markdown editors, existing products, GitHub integration mechanics. Plus `crdts-in-production.md`, 2026-10-13: Notion, Zed, Figma, Linear, Liveblocks and others, agent-editing patterns, and file→CRDT bridges compared with our replay. Plus `drafts.md`, 2026-10-25: Upwelling, Patchwork branching, and how Figma, GitBook, Ellipsus, Lix and Jazz do drafts next to live editing.
