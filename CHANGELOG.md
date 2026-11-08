# 📜 Changelog

How Red Letter got built, newest first. Live at [diff.satanworker.com](https://diff.satanworker.com); the design and current status are in [docs/DESIGN.md](docs/DESIGN.md).

## 2026-11-09: Table stress test

- **`bun bench/stress.ts --doc tables`**: a doc of tables only (10 to 200 rows, 3 to 12 columns, one of 2,000 rows), measured scrolling, flinging, sideways scrolling, jumping and typing in a cell, against the same tables as a static page and a contenteditable cell in them; it also checks that the header row sits at the top on every frame of a scroll (it did, on all of them).
- **Typing in a long table is fast again**: a keystroke rewrote every cell of the table (2–4 s a key in a 2,000-row table; now 0.2–0.6 s, where a plain contenteditable cell in the same table takes 0.1–0.2 s), and each edit made the editor guess the table's height anew, so a 200-row table at the edge of the view was redrawn twice a key. In a 200-row table typing is now within a few ms of the browser's own contenteditable cell.
- **The first column is pinned only in tables wider than the text column**: thousands of pinned cells doubled a keystroke's cost in a long table.
- **The last column of a table has no right padding**, as designed: its rule was dropped by a selector the editor's theme couldn't read.

## 2026-11-08: Links in tables

- **⌘/Ctrl+click opens links in table cells**, as in the rest of the doc (it did nothing there).
- **Outline links inside a table work**: the link is brought to the middle of the view and flashes in its cell, instead of the click doing nothing visible.
- **A comment's quote in a table cell** now selects the commented text in the cell when clicked in the panel.
- **Thin grey scrollbars** everywhere: a rounded Middle Grey (`--side`) thumb on a clear track, like macOS, in Chrome, Edge, Safari and Firefox.
- **The outline shows the doc's `#` title** as its first row, with the other headings indented under it, as in Ulysses (it was left out).
- **Outline rows show their full words on hover**, for headings and links cut short with "…" (a link's url under its text).
- **The logo is an SVG**: the Grandstander font no longer loads just to draw "Red Letter".
- **Outline is the side panel's first tab**, before Comments and History (Left/Right follow the new order).
- **The site ships Solid's production build**: Bun picked Solid's development build (devtools graph, dev warnings) for the live site because `NODE_ENV` wasn't set; `build.ts` now sets it.
- **Typing paints before it's recorded**: the editor's binding to Automerge is our own (`sync.ts`, replacing `@automerge/automerge-codemirror`) and hands each keystroke to Automerge a frame after it's on screen, so keys land 1.5 ms sooner at 1k lines and 3.5 ms at 17k (median). Edits from others that arrive meanwhile merge as concurrent ones; anything that reads the doc (comments, save, copy) gets the held typing first.
- **Long tables keep their header row** at the top of the view while you scroll down through them, and **wide tables keep their first column** while you scroll sideways.

## 2026-11-08: Outline tab

- **Outline in the side panel**: a third tab next to Comments and History lists the doc's headings Ulysses-style (hollow circles, indented by level, your section on a grey pill); click one and the doc glides there. It replaces the Linear-style rail in the doc's left margin. Also in ⌘K as "Show outline".
- **Links in the outline**: under the headings, every `[text](url)` in the doc (blue circle, url on hover); click one to bring it into view. Kept by the same per-line scan as the headings, so typing costs no more.
- **Outline clicks flash their target**: the heading or link lights up blue in the text for a moment and fades out.
- **The side panel keeps its tab** as you move between files: pick Outline (or History) and the next page opens on it too, instead of going back to Comments.

## 2026-11-08: Table of contents lands where it should

- **Clicks land and stay**: a heading glides to its place in 250 ms (one far away is jumped to a screen short of it first), steering to where the heading is as drawn rather than to CodeMirror's first estimate; any wheel, key or press stops it. On the 17k-line stress doc clicks took 1.5–3 s and far ones landed up to 13,000 px off; now they land at 0 px.
- **Text no longer slides away under the reader**: when the parser or a late image changes heights above the view while the editor isn't focused (reading, after a click in the contents or the panel), the view keeps its place, as CodeMirror only does with focus (`keepPlace.ts`). Line height estimates for undrawn text no longer flip between 16 and 44 px (a padded line was being sampled), and tables, images and diagrams tell CodeMirror their size before they're drawn.
- **`bun dev.ts` no longer dies** when several files change at once: rebuilds run one at a time.

## 2026-11-08: Slimmer header

- **Repo name in the sidebar**: `owner/name` moved from the header to the file sidebar's top row (next to your avatar, linking to the branch); the header drops the file path, which the tab already shows. The branch pill only switches branches; "New draft" moved to the page menu.
- **"Add icon" lines up with the title**: its label starts where the H1's first letter does, not 48 px to its left.
- **Full emoji picker for doc icons**: "Add icon" opens `emoji-picker-element` (every emoji with search, categories, skin tones and recents, in the OS emoji font) instead of 32 fixed emoji; loaded on first open, its data served from our own assets.
- **Drafts hidden** until pull requests and reviews are designed: "New draft", the draft bar and `drafts/*` branches are gone from the UI. The branch picker lists the repo's default branch, so a draft branch opened by URL (e.g. `drafts/satanworker/findings-edits`) still leads back to `main`.

## 2026-11-08: Comments on protected branches

- **Comments on any path open their PR**: the comment branch is `red-letter/comments/<sha1(branch)>/<sha1(path)>`, so a doc under a dotted folder (`.devcontainer/README.md`) or with a space in its name no longer fails with "not a valid ref name". A PR opened before this keeps its old branch; new comments open a new one.

## 2026-11-08: Performance on huge docs

- **Stress benchmark** (`cd web && bun bench/stress.ts`): `/__stress` generates one doc with every kind of block (headings, lists, tasks, quotes, code in six languages, tables, images, diagrams, comment threads), and the bench types, scrolls and jumps through it in a headless Chromium, against the same machine's native floor (a `<textarea>`, the text as a static page). Exits 1 when a budget is missed.
- **Typing no longer slows down with the doc**: on a 17k-line doc a keystroke went from ~300 ms of work (keys queued up for seconds) to ~31 ms p95 next to the textarea's ~21 ms; on a 1k-line doc from 48 to 26 ms. Tables, images and diagrams rescan only the blocks an edit touched, comment markup and headings follow edits instead of re-reading the whole text, the word count is kept per chunk of text, and the panel, table of contents and sidebar stop redrawing rows whose content didn't change.
- **Diagrams render in a worker**: a screen of new mermaid diagrams no longer stalls scrolling and typing for a quarter of a second.
- **Scrolling and jumps**: the table of contents reads the section in view in the editor's layout pass and draws only the rail's visible bars; comment cards outside the panel's view skip layout and paint.

## 2026-11-08: Avatars

- **Avatars no longer go missing at random** (sidebar one load, topbar the next): they load from GitHub's avatar CDN by login instead of `github.com/<login>.png`, a redirect that intermittently answers 504.

## 2026-11-07: Typography guideline

- **Typography** to the Figma "Typography Guideline" for both modes, checked block by block against Figma's two example pages (same text, measured positions). Editing shows the markdown the way Figma's markdown mode does: `**`, `*` and backticks look like the text they wrap instead of greyed out, `#` marks hang 12 px left of the heading at its size, beside its last line, a link's `[name]` is blue and its `(url)` grey with the url underlined. Reading shows link names blue and underlined.
- **28 px between blocks**, as in the Figma pages: a blank line after a paragraph, list, table or code block is 28 px tall; next to a heading or a rule it stays one line and the heading's own padding makes up the rest.
- **Text runs the full 620 px** of the column (it was 616), and long urls wrap after a `/` or `.` instead of jumping whole to the next line.
- **Inline code and code blocks** on a light grey in the doc's own font and colour (were red, in a system monospace); code blocks have rounded corners and 16 / 20 px of room around the code.
- **Lists:** items sit on consecutive 18 px lines again, numbered lists included; reading-mode dots and boxes are centred on the line, the text 16 px in.
- **Rules** (`---`) are drawn in editing mode too, as a thin line across the column, 28 px from the blocks around them.
- **Tables** run the full column width with hairlines only between rows, a bold header and no shaded header row. While editing, cells show their markdown (styled like the text) so clicking into one changes nothing; reading renders it, links as links.
- **Comment highlights** in Figma's pale yellow with rounded corners, without the underline.
- **Table of contents** no longer throws on every scroll of a doc with fewer than two headings, and measures its rail as soon as a second heading appears.

## 2026-11-07: Tab styling, page menu

- **Tabs** styled to Figma: file names only, the open tab white and running into the page, a grey pill on hover, thin rules between the others, 15 px × and + icons.
- **"…" menu** in the header: Copy link, Duplicate, Copy page contents (without comment markup), Move to and Delete page. Move and delete are one commit each and take the doc's snapshot with them.
- **Header path** in Onyx, like the rest of the text (was grey).
- **Table of contents** that behaves like Linear's: a rail of bars in the doc's left margin, one per heading, shorter for subheadings and darker where you are; hover it and a list of headings springs open in its place, click one and the doc glides there.

## 2026-11-07: Reading mode, typography

- **Reading and editing modes:** the pencil in the word-count corner switches modes, and the choice is remembered per browser. Reading hides the markdown, draws bullets as dots, tasks as boxes (checked ones filled and struck through) and `---` as a rule, and makes the doc read-only. Comments still work. Docs you can't push to always open in reading mode.
- **Typography** to the Figma "Basic Typography" guide: body text on 16 px lines, H1 24 px (was 28), quotes with a darker bar and 4 px above and below, list items a blank line apart so wrapped ones don't run together, and list and task markers in the text colour when editing.

## 2026-11-07: Nov 5 redesign, collapsible sides
- **Restyle** to the Figma frame "RED LETTER 5 NOV": a 620 px text column, a header split over the sidebar (logo and files toggle) with a muted path and a plain Share, your avatar and name atop the file sidebar, 15 px file and folder icons, a white comment box ("Write down what you think", a Send button) and a white "Add a comment" pill, quieter tab counts and quotes. Where two frames meet there is now one hairline instead of two.
- **Collapsible sides:** the file sidebar folds to a 38 px rail (avatar, file search) and the comments panel folds away, each from its header toggle and remembered per browser. Opening a thread or a panel tab brings the panel back.
- **Word count** in the doc's bottom-right corner, live as you type.
- **File tree:** switching files no longer closes the folders you opened. The "+" new-file button is gone with the new design, for now.
- **Resolve and Delete are separate:** a resolved thread stays in the file (`<!--rl:c1 resolved`), folds under "N resolved" in the panel and loses its highlight, which comes back while you hover its card; Reopen brings it back. Delete removes the thread from the file, after a confirm.
- **Clicks below images, tables and diagrams** land where you click again: those blocks had vertical margins, which CodeMirror doesn't measure, so every line under them was mapped higher than it's drawn.
- **Tabs**, as in Chrome: a click on a file replaces the open tab's file (or goes to its tab), ⌘/Ctrl+click opens it in a background tab, "+" opens the file finder into a new tab, × closes one. Tabs shrink to share the strip, then scroll sideways without a scrollbar; "+" stays in sight. Kept per repo and branch across reloads. Functional first; the Figma styling comes next.
- **Switching files no longer blanks the screen:** the open file stays until the next one is ready, then the two swap in one update, so the comments panel and header status no longer vanish and come back on every switch. Clicking the open file's own link does nothing instead of reopening it.
- **A clicked comment lets go:** clicking anywhere in the text outside a comment's highlight takes the highlight off it and its card; before, it stayed lit until another comment was picked.

## 2026-11-02: History without approvals
- **History tab:** clicking a commit shows what it changed in the file (its GitHub diff); clicking again hides it. Agent commits no longer wait for "Looks good" or stay highlighted in the text; only edits that collided with yours are flagged, with Keep yours / Keep agent's / Keep as merged. Per-change Revert is gone.

## 2026-11-01: Comments in the file

- **Comments are HTML comments in the doc:** markers around the commented text and a thread block at the end of the file. GitHub's page hides them, agents read and answer them in the file, and they sync, save and merge with the text. Resolve deletes a thread. Red Letter no longer reads the `red-letter-comments` branch; its comments weren't carried over.
- **Protected branches:** the doc opens read-only with a "protected" badge, and comments go through one pull request per doc, opened by the first comment.
- **Table cells:** commenting on a cell works again (the comment box closed as it opened), and a cell being edited no longer shows comment markers.

## 2026-10-26: Editing comforts

- **Doc icons:** an emoji at the start of the first `# ` heading is the doc's icon. "Add icon" over the title picks one, and it shows as the browser tab's favicon and next to the file in the sidebar.
- **Slash menu:** `/` at the start of a line inserts headings, lists, tasks, quotes, code blocks, mermaid diagrams, tables and dividers.
- **Bold and italic:** ⌘B / ⌘I (Ctrl on Linux and Windows) wrap or unwrap the selection and combine into bold italic.
- **Images:** paste or drop an image into a doc. It uploads at once, is linked on its own line, and is committed next to the doc with the next save.
- **Presence:** your own other tabs on a file no longer show as a second avatar of you.
- **Comments:** text typed right after a commented word no longer joins the comment's highlight.
- **History tab:** the file's commits as a timeline linked to GitHub; unreviewed agent commits open into Revert / Keep / Looks good. It replaced the Agent changes tab, and the side panel is always open.
- **Editor layout:** a centred column up to 780px wide. Markdown syntax always shows, muted, so moving the cursor never reflows the text; heading marks hang in the left margin.

## 2026-10-25: Figma redesign and drafts

- **Redesign** from the Figma file "Red Letter": Google Sans Code, grey panels, exported icons, Reply / Resolve buttons. Then restyled in Tailwind v4 and checked against Figma on the `/__figma` overlay.
- **Drafts:** fork a file into `drafts/<login>/<name>`, pull in new edits from the base branch, and merge back in one atomic step.
- **⌘K palette** of files and actions, **@mentions** in comments, **repo images** in docs, and a GitHub Actions deploy.

## 2026-10-22: Diagrams, dark mode, code

- **Dark mode** that follows the system.
- **Mermaid** diagrams render under their source (ELK layout via beautiful-mermaid).
- **Code highlighting** with Pierre's highlighter.
- **Tables:** wider, and comments can sit on text inside a cell.

## 2026-10-14: Fast, offline, tables

- **Solid rewrite** with stores per feature (repo, doc, comments); switching files no longer reloads the page.
- **Offline:** docs and GitHub responses are kept in IndexedDB, and a service worker caches the app. Files open at once, and offline edits survive reloads and save when the connection is back.
- **Comments** show at once and are written to git in the background.
- **Background sync** fetches every doc of the branch, so any file opens instantly.
- **Obsidian-style tables:** edit cells in place, Tab / Enter to move, right-click to add or delete rows and columns.
- **New files** from the sidebar's "+".

## 2026-10-13: First prototype

- **Web app:** CodeMirror 6 + Automerge, live sync through a Go hub, agent pushes replayed into open tabs as reviewable changes, conflict flags, and comments stored in git.
- **Notion-style live preview**, sign-in with an OAuth App as well as the GitHub App, one live-sync room per file with presence avatars.
- **Repo view:** file sidebar, default-branch and repo-root URLs.
- **Deploy:** static site on Cloudflare at diff.satanworker.com, hub on home-satan behind a Cloudflare Tunnel at diff-api.satanworker.com.
- **Research** on how CRDTs are used in production and what that means for replay and agents.

## 2026-10-12: Design and spikes

- **Design sketch** and research: prior art, CRDT comparison, markdown editors, existing products, GitHub integration.
- **Spikes:** deterministic replay, conflict flags, GitHub API mechanics, a browser end-to-end smoke test.
