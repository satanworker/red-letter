# 📜 Changelog

How Red Letter got built, newest first. Live at [diff.satanworker.com](https://diff.satanworker.com); the design and current status are in [docs/DESIGN.md](docs/DESIGN.md).

## 2026-11-07: Nov 5 redesign, collapsible sides

- **Restyle** to the Figma frame "RED LETTER 5 NOV": a 620 px text column, a header split over the sidebar (logo and files toggle) with a muted path and a plain Share, your avatar and name atop the file sidebar, 15 px file and folder icons, a white comment box ("Write down what you think", a Send button) and a white "Add a comment" pill, quieter tab counts and quotes. Where two frames meet there is now one hairline instead of two.
- **Collapsible sides:** the file sidebar folds to a 38 px rail (avatar, file search) and the comments panel folds away, each from its header toggle and remembered per browser. Opening a thread or a panel tab brings the panel back.
- **Word count** in the doc's bottom-right corner, live as you type.
- **File tree:** switching files no longer closes the folders you opened. The "+" new-file button is gone with the new design, for now.
- **Resolve and Delete are separate:** a resolved thread stays in the file (`<!--rl:c1 resolved`), folds under "N resolved" in the panel and loses its highlight, which comes back while you hover its card; Reopen brings it back. Delete removes the thread from the file, after a confirm.
- **Clicks below images, tables and diagrams** land where you click again: those blocks had vertical margins, which CodeMirror doesn't measure, so every line under them was mapped higher than it's drawn.

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
