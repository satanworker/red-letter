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

- `refs/heads/<branch>` — the file, comments included. Truth.
- `refs/red-letter/v1/<sha1(branch)>/<sha1(path)>` — parentless commit holding `doc.automerge` + `meta.json {docId, branch, path, commit, heads}`. Doc identity and history. Hashed names: `<branch>/<path>` collides and hits ref directory/file conflicts.
- `red-letter/comments/<branch>/<path>` — only for a protected branch: the doc plus new comments, with one open pull request into `<branch>`.

## Comments

Comments are HTML comments in the doc (`web/src/comments/inline.ts`), so GitHub's rendered page hides them and agents read them with the text:

```
The hub <!--rl:c1-->relays live sync<!--/rl:c1--> and nothing else.
…
<!--rl:c1
@satanworker 2026-11-01T10:12Z: Should this mention the OAuth exchange?
@agent 2026-11-01: Added a sentence.
-->
```

Markers wrap the commented text; each thread's block sits at the end of the doc. A message starts a line with `@login date: ` (the date is optional); lines indented two spaces continue it; `-->` in a body is written `--&gt;`. A resolved thread keeps its markers and messages and says so on its block's first line (`<!--rl:c1 resolved`); reopening drops the word. Deleting a thread removes its markers and block: git history is the record. Nothing inside fenced code counts. Because comments are text, they sync live, save with the doc, survive offline and follow every edit (the CRDT carries them), and a draft's merge carries them along.

- **Branch you can push to:** a comment is an edit to the doc, made outside the undo history. The editor hides the markup and keeps it intact (`web/src/doc/commentMarks.ts`): markers and blocks are atomic, typing at a range's edge stays outside it (and at the end of the doc, above the blocks), Backspace / Delete next to hidden markup delete the visible character, and a copy leaves the markup out.
- **Protected branch** (GitHub's `protected` flag; the doc opens read-only, "protected" badge): comments go to the doc on `red-letter/comments/<branch>/<path>` through the contents API, and the first opens a pull request. With no open PR the branch starts over from `<branch>`; otherwise `<branch>` is merged into it first (`POST /merges`). New comments map from the doc to the PR's copy through the text without markup, so the two must differ only in comments: before each write the doc catches up with the branch (its first sync, then a fresh poll). Merging the PR changes nothing in the rendered page. The panel shows the PR's threads on the doc.
- **No push access:** no comments.

## Browser, per open file

1. Sign in: GitHub App user-to-server token (8h, refresh 6mo), kept in the browser only.
2. Load the snapshot ref. Absent → init from the file blob, `POST git/refs` to create it. 422 `Reference already exists` = someone else won; load theirs. Git is the lock.
3. Walk first-parent commits from branch head back to the doc's last known commit; replay each agent commit in order (see below). Browser commits carry a `Red-Letter-Heads:` trailer and are never replayed; if those heads are missing locally, merge the snapshot.
4. Connect relay. Edit in CodeMirror 6. Replica in IndexedDB; offline works. The CRDT holds LF; the committer restores the file's EOL.
5. Poll `GET git/ref/heads/<branch>` every ~15s with `cache:"no-store"` + manual `If-None-Match` (304s are free; default fetch serves refs from cache for 60s). Changed → step 3.
6. Idle 30s / explicit save: `POST trees` (inline content) → `POST commits` (trailer) → snapshot `blob → tree → commit` → GraphQL `updateRefs` moving branch + snapshot ref atomically with CAS. Any error → poll, replay, retry. (REST `PATCH` has no CAS on non-branch refs.) 7 calls, ~3–4s.
7. Comments: edits to the doc (see Comments).

Agent: `git pull`, edit, `git push`. Comments are in the file: reply by adding a `@login: ` line to a thread block, resolve by adding ` resolved` to its first line (`<!--rl:c1 resolved`), delete it by removing its markers and block. On a protected branch, new ones wait in the doc's comment PR (`gh pr list`). Nothing to install.

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
| Comments | HTML comments in the doc: range markers + a thread block at the end; a protected branch takes them through one PR per doc | hidden on GitHub's page, read by agents with the file, carried by the CRDT. The orphan branch they replaced was invisible to people and agents alike; PR review comments only attach to lines the PR changes |
| Auth | Two options, both with tokens kept only in the browser. Default: classic OAuth App (`repo` scope, expiring tokens with refresh): one click, any repo the user can reach, nothing to install. Alternative: GitHub App user-to-server tokens, which see only repos where the App is installed | The OAuth App removes install friction when sharing links. The GitHub App suits people and orgs who want per-repo scoping. Orgs with OAuth access restrictions must approve the OAuth App. |
| Commit | Git Data API + GraphQL `updateRefs` | atomic file + snapshot move with real CAS on both refs |
| Transport | websocket relay | WebRTC adds signalling/NAT pain for nothing; offline merge is a CRDT property, not a transport property |

## Known risks

- Myers diff ≠ keystrokes: same-word edits interleave. Flagged and highlighted (see above); humans review. `updateText` is Beta.
- Signed-commit branch protection rejects unsigned user-token API commits. Use draft branches; main gets bot-signed + `Co-authored-by` if needed.
- Secondary rate limit: ≤80 content-creating req/min, ≤500/h per token. A save is 6 writes + reads. Serialise, keep idle ≥30s.
- Doc identity: change anchors (agent marks, conflicts) are op IDs in one specific Automerge doc. Lose the snapshot ref, lose those. An agent's `git push --mirror` deletes `refs/red-letter/*`; a default clone doesn't fetch them. Comments don't depend on it: they're text.
- Comments are in the file: an unresolved or resolved one ships wherever the file goes until deleted (hidden when rendered, visible in the source), and each comment, resolve or delete changes the doc's history.
- Agent→browser latency is the poll interval, not ~1s webhook.
- `@automerge/automerge-codemirror` is 0.2.0 vs `y-codemirror.next` at 171k/wk. Price of the right primitive. Works in the smoke test.
- `updateRefs` with a GitHub App user-to-server token: verified working in the prototype (autosave commits on `demo`).
- Replay determinism is a cross-version contract: change bytes depend on the Automerge version, the diff and the actor recipe. Mixed builds duplicate text (Jupyter's duplication bugs are this). Done: Automerge pinned to exactly 3.5.0, `replayVersion` in `meta.json`, and a tab refuses a snapshot from a newer version.
- The relay accepts ops from anyone holding a docId, and an honest tab later commits them under its own name. Done: the hub admits a tab only with push access to the repo.
- Replayed agent changes must stay off the human's undo stack. Done: remote transactions are marked `addToHistory: false`; verified that Ctrl-Z skips the agent's edit.

## Prototype status (updated 2026-11-07)

Live at `diff.satanworker.com`; code in `web/` and `server/`; run/deploy notes in `README.md`. Verified end to end with two tabs and a git-pushing "agent" on the `demo` branch of this repo.

Done:
- **Sign-in, two options** (tokens only in the browser; the hub exchanges codes and stores nothing):
  - Default "Continue with GitHub": OAuth App "Red Letter", `repo` scope, expiring tokens with refresh, nothing to install. Verified on localhost.
  - "Use the GitHub App instead": [`red-letter-diff`](https://github.com/apps/red-letter-diff), per-repo install. Its user token (8 h, with refresh) commits through `updateRefs`, which closed the last open risk from the spikes. A repo without the App routes the user to its install page.
- **Live sync and saving:** edits sync through the Go hub, one room per file (repo + branch + path) with presence avatars of the other people there (your own other tabs aren't shown, but still count as "someone here" for saving on close). Saves happen 30–40 s after the last edit or on Save / Ctrl-S.
- **Agent pushes:**
  - replayed into every open tab without duplicated text;
  - in the History tab: the file's commits on the branch as a timeline (newest first, last 50; merges hollow). Clicking a commit opens what it changed in the file (GitHub's diff of the commit, a merge against its first parent; cached for good) and clicking again closes it; ↗ opens it on GitHub. Nothing waits for approval and nothing stays highlighted in the text;
  - where they interleave with a human edit, flagged in the text and on their History row (red dot, counted on the tab) with "Keep yours / Keep agent's / Keep as merged". Verified on `demo`: an agent push overlapping an unsaved edit flagged only the overlap, its other line went in unmarked, Keep yours settled it and the count went away.
  - Ctrl-Z never reverts an agent's or a peer's change.
  - a Red Letter save of *another* file on the branch is replayed (a no-op here) instead of stalling the walk: its trailer's heads belong to that file's doc.
- **Drafts** (see Drafts above; branch `drafts` / worktree `red-letter-drafts`): the branch picker in the header lists the base branch and every `drafts/*` branch and has "+ New draft…". Inside a draft a bar over the doc offers Changes, "Update from <base>" (when the base moved) and "Merge into <base>". Verified on `demo` with a scratch file: draft edits plus a concurrent agent push to `demo` (one overlapping word) → Update merged both and flagged the overlap → the agent pushed again → Merge pulled that in and stopped for review → Merge again landed one merge commit on `demo` that touched only the drafted file, deleted the draft branch and its snapshot ref, and the `demo` tab replayed it as a reviewable change.
- **Comments** (inline HTML comments, see Comments above):
  - started from the "Add a comment" pill on a selection, which turns into the comment box in place (Enter sends, Esc cancels); the thread shows in the side panel only once sent (Figma `129:1498`);
  - `@` in a comment or reply lists the repo's collaborators with their avatars (`GET /repos/{repo}/collaborators`, first 100); bodies keep plain `@login` text, as on GitHub, shown as chips. No notifications yet;
  - shown as threads with replies. Resolve hides a thread under "N resolved" at the foot of the panel and takes its highlight off the text; hovering its card there lights the text up again, and Reopen brings it back. Delete (after a confirm) removes the thread from the file. The tab counts open threads. Verified on `/__figma`: resolve set the flag and kept the markers, the hover lit only that thread's text, reopen and delete left the doc byte for byte as expected;
  - verified on `demo`: comment, reply and delete (then called Resolve; the file came back byte for byte, except a final newline it lacked); text typed after the commented word stays out of it, Backspace after it deletes the word's last letter, a copy has no markers;
  - verified on a protected scratch branch: the first comment opened the PR, a reply and a resolve added commits, a push to the branch was merged into the PR's copy before the next comment, and a reload showed the PR's threads on the doc; after the PR was closed (branch kept or deleted) the next comment opened a fresh one. Forced with delayed responses: a comment sent while this browser's copy was still behind a push lands, and a refresh that read the PR before a comment and answered after it doesn't take the comment off the panel.
- **URLs and file browser:** `/owner/repo` opens the default branch's README with a sidebar listing the branch's markdown files (collapsible tree + filter); `/owner/repo/tree/<branch>`, `/owner/repo/blob/<branch>/<path>` (GitHub's shape) and `/owner/repo/<path>` (default branch) all work. Missing files show the sidebar with a not-found note. Opening a file opens its folders; nothing closes a folder but the reader. Creating a file (prefilled with the open file's folder, `.md` added if no extension; it joins the list and opens at once with a `# Title` line, committed by a background save with one `updateRefs`, which also creates the snapshot ref) has no button since the Nov 5 design dropped the sidebar's "+"; the form stays in `FileSidebar.tsx` for when it comes back.
- **UI:** Notion-style live-preview editor: a centred 620 px text column (Figma `142:2967`); headings, emphasis, lists (wrapped lines and Shift-Enter continuations align with the item's text), quotes, code and images styled inline. Markdown syntax always shows while editing, so moving the cursor never reflows the text, styled as Figma's markdown mode (`148:3509`): `**` / `*` / backticks take their content's style, heading marks (`## `) hang 12 px left of the heading at its size in Dark Grey, beside its last line, a link's `[name]` is blue and its `(url)` Shadows grey (urls wrap after `/` and `.`), list markers stay as typed, a task's `[ ]` toggles on click; `---` is drawn as a rule in both modes. Blocks sit 28 px apart as in the Figma pages: a blank line after a block is 28 px tall, but next to a heading or rule it stays 16 px and the heading's 12 px padding (or the rule's 12 px half-line) makes up the rest; the next blank line in a run stays 16 px, so typing on a new line never moves it. Checked against `148:3509` and `150:3757` by measuring every block of the same text: positions and heights match except where Figma itself puts paragraphs 16 px apart and in table row heights (columns here fit their content; Figma's are equal thirds). GFM tables are edited Obsidian-style (`web/src/doc/tables.ts`): cells are edited in place (while editing every cell shows its markdown, styled; reading renders it), Tab / Shift-Tab / Enter move between cells and add a row past the end, arrows and Escape leave the table, right-click inserts or deletes rows and columns, Ctrl-Z/Y go to the editor's history. A cell edit writes only the changed characters of that cell. Breadcrumb header with branch pill, save state and Share; a word and character count in the doc's bottom-right corner follows typing. Both side columns collapse from header toggles (remembered per browser): the file sidebar to a 38 px rail with the reader's avatar and file search (⌘K), the comments panel away entirely; opening a thread or a panel tab brings the panel back. Built with Solid 1.9 (compiled by `@dschz/bun-plugin-solid` under `bun build`); state lives in per-feature stores (`repoStore`, `docStore`, `commentsStore`), components only render and call actions.
- **Wide blocks:** tables and diagrams stay in the text column: a wide table wraps its cells (whole words), then scrolls.
- **Visual design:** follows the Figma file "Red Letter" (frame `RED LETTER 5 NOV`, node `129:1304`; collapsed sidebars `137:2148`; comment flow `129:1498`): Google Sans Code throughout (12 px on 15 px lines in the chrome; the doc follows the typography guideline `140:2782`: 12 px on 16 px lines, H1 24 / H2 20 / H3 16 Medium, bold SemiBold, every list on 18 px lines with no gap between items (the guideline draws numbered lists at 16 px; next to its 18 px bullets they looked cramped), inline code and code blocks on Middle Grey in the text's font, links `#4E0DFF`, comment highlights `#FFEEBA`, tables ruled only between rows), Grandstander logo, greys Onyx `#373737` / Middle `#EBEBEB` / Dark `#D8D8D8` / Shadows `#ADADAD`, one shared button shadow, a header split over the 320 px file sidebar (logo, files toggle) and the rest (path in Onyx, comments toggle, save state, plain Share), 320 px file sidebar (reader row on top, 15 px file and folder icons) and panel around a flexible doc column holding the centred 620 px text column. Figma draws frame strokes centred, so where two frames meet there is one hairline: the header's. Styling is Tailwind v4 (`web/src/app.css` holds the tokens as CSS variables, which CodeMirror's themes share; `bun-plugin-tailwind` in `build.ts`). Icons are the SVGs exported from Figma (`web/src/icons/`), inverted in dark mode. Fonts load from Google Fonts. Panel tabs: the chosen tab is white with its label, the other a grey icon + count; History took the place of Figma's Agent changes tab. Images (`![alt](path)`) show under their markdown line, repo-relative paths read from GitHub. Checked against Figma on `/__figma` (README).
- **Keyboard:** every control is a button or link with a visible focus ring; Up/Down walk the file tree; Left/Right switch the panel tabs; Esc closes every input; ⌘⌥M / Ctrl+Alt+M comments on the selection. ⌘K / Ctrl+K opens a palette of files and actions (comment, show comments / history, show or hide files, show or hide the comments panel, copy link). In the editor, ⌘B / ⌘I (Ctrl on Linux/Windows) wrap the selection in `**` / `*` or unwrap it, and combine into `***bold italic***`; `/` at the start of a line opens a menu of blocks (headings, lists, task, quote, code, mermaid, table, divider; `web/src/doc/slash.ts`, CodeMirror autocomplete) that filters as you type and replaces the `/word` with the block's markdown; Tab indents: Esc then Tab leaves it (CodeMirror's tab focus mode).
- **Pasted and dropped images:** uploaded at once as git blobs and linked on their own line as `![name](images/<name>-<sha7>.<ext>)` next to the doc; the doc's `images` map (src → blob sha) lets every tab show them before they're saved. A save commits the ones the text still links to, with the file, in the same commit; a draft's merge carries them to the base (not yet exercised). Verified on `demo`: paste, drop mid-line, save committed both linked images and skipped an unlinked one.
- **Doc icon:** an emoji at the start of the doc's first `# ` heading (`# 🚀 Title`), so it's plain markdown GitHub shows too. Writers get "Add icon" / "Change icon" over the title while the pointer is on the doc (`web/src/doc/IconPicker.tsx`): a grid of common emoji, a field for any emoji (focused on open, so the OS emoji picker works), Remove. A doc without a `# ` heading gets `# <icon> <file name>` at the top. The browser tab's favicon is the open doc's icon (the ¶ otherwise). The file sidebar shows each doc's icon in place of the file icon: background sync reads it from every doc's copy, closing a doc records its latest, and the open doc's follows its text live. Not shown yet in the breadcrumb or palette.
- **Comments on table cells:** text selected in the focused cell maps to doc positions (`cellSelection` in `tables.ts`); the "Add a comment" pill sits on it, the selection holds while the comment box has focus, and the comment's markers go around those characters. Cells never show the markers: typing in a focused cell is diffed against its text without them and mapped back, so the markers stay put as in the rest of the doc. Verified on `demo`: comment a cell, comment text beside a commented range, type at both edges and inside, replace the whole cell, undo.
- **Mermaid:** ` ```mermaid ` blocks render as SVG diagrams (`web/src/doc/mermaid.ts`) under their source, which always shows like any code block; while typing, the last picture stays until the new one has loaded, and a source that doesn't parse fades it (the error is its tooltip). Renderer lukilabs `beautiful-mermaid` 1.1 (ELK layout, no DOM): lazy chunk of 1.6 MB (470 KB gzipped), 20–70 ms a diagram, cached per source. `@vercel/beautiful-mermaid` (45 KB gzipped, ~5 ms) shipped first and was dropped: it showed the quotes of `A["label"]`, ignored `<br/>` and drew back edges outside the picture. mermaid.js is 1.5 MB gzipped and needs the DOM; Selkie (Rust/WASM, ~725 KB gzipped) isn't on npm.
- **Dark mode:** follows the system (`prefers-color-scheme`); every colour is a CSS variable in `web/src/app.css`, the editor themes use them too. Diagrams are `<img>`s carrying their own dark-scheme media query.
- **Code highlighting:** fenced code blocks get syntax colours from Pierre's `@pierre/highlights` (hand-written WebAssembly; tokenizing is ~0.3 ms per 1,000 lines) with the Pierre light/dark themes combined through CSS `light-dark()` (`web/src/doc/highlight.ts`). Loaded on the first code block (267 KB chunk, wasm inlined); tokens are cached per block, so only the block being typed in is re-tokenized.
- **No page reloads:** links, back/forward and the landing form go through the Navigation API; switching files keeps the page, the sign-in and the file list, and swaps only the doc (the old file leaves live sync at once). The open doc stays on screen until the next one is ready, then they swap in one update, so the panel and header never unmount. Browsers without the Navigation API get page loads.
- **Tabs** (`Tabs` in `EditorScreen.tsx`, `repo.tabs`), Chrome-style: a strip over the doc, per repo + branch in `localStorage` (`rl_tabs:<repo>@<branch>`); files no longer on the branch drop out. A plain click on a file link (sidebar, palette, breadcrumb, back/forward) goes to its tab if it has one, else replaces the open tab's file; ⌘/Ctrl+click adds a background tab right after the open one (a link to another branch or repo opens there in a new tab); "+" opens the file finder and the pick gets a new tab. × closes a tab (the open one hands over to its right neighbour, else its left); the last tab can't be closed, since the route always names a file. Tabs are up to 200 px and shrink to share the strip, down to 56 px, then scroll sideways with no scrollbar (trackpad or wheel; the open tab scrolls into view) while "+" stays in sight. Only the open tab has a live Session; the others reopen from this browser's copy. Styled to Figma `140:2830`: file name only, the open tab white, 3 px wider each side and running into the doc, with its ×; a hovered tab is a grey pill (× on hover); a 1 px rule parts two tabs unless either is open or hovered.
- **Page menu** (`PageMenu.tsx`, Figma `134:1701`): the header's "…" after Share, a native popover (light dismiss, Esc). Copy link; Copy page contents (the markdown without comment markup, as an editor copy gives it); and, with push access, Duplicate (`x copy.md` next to it, opened in a new tab, committed by a background save like a new file), Move to (a path prompt; `.md` added as for new files) and Delete page (after a confirm). Move and delete save unsaved text first, then are one commit plus the snapshot ref's deletion in one `updateRefs`; this browser's copy goes too. A moved file starts over at its new path: comments go with it (they're text), agent marks don't. Other tabs open on it replay the commit and find it empty. Verified on `demo`: duplicate, move to `scratch/moved.md` (git saw a rename), delete; the branch's tree ended as it started and both snapshot refs were gone.
- **Table of contents** (`Toc.tsx`, `selectHeadings`; card looks from Figma `145:3163`, rail and behaviour measured on Linear's documents): with two headings or more, a rail of 1 px hairlines 4 px inside the doc column's left edge, vertically centred, 12 px apart, one per heading, right-aligned and shorter for deeper levels (8 / 6 / 4 px), in Shadows grey; the reader's section is 2 px thick and Onyx. A lone leading `#` heading is the doc's title and stays out, as Linear's title does. Each heading has a scroll margin (16 px at the top level, 6 px deeper): a click glides its text to 24 px + that margin under the doc's top edge (40 / 30 px), measured again once there since CodeMirror estimates undrawn lines. The reader's section is the last heading whose text is within 32 px + its margin of the top (48 / 38 px), the first before any; the 8 px of slack keeps a clicked heading lit. Over the last 120 px of scroll that line slides down to 20 px above the viewport's foot, so headings too near the end to reach the top light up one by one and the last one at the very end. With more headings than fit, the rail slides to keep the lit one in sight and fades at its cut edges. Hovering the rail (or tabbing into it) springs a card open in its place (from half size, 16 px to the left, transparent; a slight overshoot) while the rail fades; leaving closes it at once. The card lists the headings indented by level, the current one darkest. Hidden when the doc column is under 768 px. Verified by scanning Linear's doc and ours in 1–2 px steps: Linear lights an H1 at 48 px and an H3 at 38 px with no hysteresis, and its last two unreachable headings at 99 and 41 px from the end (one alone at 71); ours on `markdown-editors.md` lit sections at 48 px, subsections at 37 px, the last two at 109 and 77 px from the end, and clicks landed at 40 / 30 px with the clicked heading lit.
- **Browser storage** (one IndexedDB database, `red-letter`; everything in it is a copy, GitHub stays the source of truth):
  - `docs`: each opened doc, saved at most once a second. A file reopens from it at once, then merges the snapshot if someone saved since and replays agent commits. Text edited offline survives reloads and goes to git when the connection is back (verified: offline edit → offline reload → online → saved).
  - `http`: GitHub GET responses. Sha-addressed ones (commits, trees, blobs, file contents at a sha) are never refetched; the rest revalidate with ETags and are used as-is offline.
  - Safari can drop the connection: every operation reopens once and retries; without IndexedDB the app runs as before, from the network. `navigator.storage.persist()` is requested after the first file opens. Sign-out clears both stores.
- **Service worker** (`web/src/sw.ts`): precaches this build's hashed assets (the 3.6 MB Automerge wasm included), serves them from the cache, and fetches pages network-first with the cached shell as the offline fallback. A repo opened before loads fully offline.
- **Background sync:** after a repo opens, every doc of the branch (snapshot merged into this browser's copy) is fetched, four at a time, pausing while a file opens. Any file then opens from the copy (measured: 200 ms to switch, ~0.7 s for a reload).
- **Network:** first paint never waits on GitHub (repo info, branch, branch protection, file list and App install checks come from this browser's copy and revalidate behind it); concurrent reads of one URL share a request, and reads within 2 s share the answer; compare-and-swap paths (saves, comment PR writes, lost races) always ask GitHub.
- **Infra:**
  - static site on Cloudflare (Workers static assets);
  - Go hub + OAuth exchange on home-satan as systemd user units behind a Cloudflare Tunnel (`diff-api.satanworker.com`);
  - secrets in `~/.config/red-letter/`.

Not built yet:
- automerge-repo's incremental IndexedDB adapter instead of whole-doc saves, if docs get large;
- BroadcastChannel between tabs: skipped, the hub already syncs tabs on the same file, and adding a second adapter would announce the same peer twice;
- strip the wasm's 687 KB name section (−19% raw, −6% brotli);
- presence cursors inside the text (avatars only today);
- notifications for mentions; the comment PR doesn't mention anyone either;
- comments: a protected-branch comment that fails isn't queued (the error shows its text to copy); admins who could bypass a branch's protection still comment through the PR (`refUpdateRule.viewerCanPush` would tell them apart); text in fenced code takes no comments (the pill doesn't show there);
- drafts: publish as a PR instead of merging in-app; retroactive drafts (move unsaved edits off main into a new draft); tabs still open on a merged draft get save errors (the branch is gone); a base commit merged into a draft outside Red Letter isn't recorded in `base`, so the next Update would duplicate its text;
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
