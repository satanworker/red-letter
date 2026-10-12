# Collaborative markdown where the raw string is SoT

## Constraint that kills most “markdown editors”

This product’s CRDT is the **raw markdown bytes**, with git blob-diffs replayed as text ops. That requires a **text CRDT** (`Y.Text` / Loro `Text` / Automerge text), not a ProseMirror/Lexical tree. An editor whose collab document is a rich AST cannot ingest a GitHub webhook diff without a lossy parse.

---

## Ranked options

### 1. CodeMirror 6 + decorations + Y.Text — **v1 pick**

**Observed.** [`@codemirror/lang-markdown@6.5.2`](https://www.npmjs.com/package/@codemirror/lang-markdown) + `@lezer/markdown` parse for highlighting only; decorations never mutate the doc. [`y-codemirror.next@0.3.6`](https://github.com/yjs/y-codemirror.next/) binds `Y.Text`; remote cursors via awareness; [`YRange`](https://github.com/yjs/y-codemirror.next/blob/main/src/y-range.js) stores `Y.RelativePosition` pairs (comments belong here, not in the file). Loro has [`loro-codemirror`](https://github.com/loro-dev/loro-codemirror) + `text.getCursor` ([docs](https://www.loro.dev/docs/tutorial/text)). Automerge: [`automerge-codemirror`](https://github.com/automerge/automerge-codemirror) (smaller ecosystem).

Live-preview (Obsidian-style hide markers):
- [`codemirror-live-markdown@0.5.1-alpha.1`](https://github.com/blueberrycongee/codemirror-live-markdown) — modular decorations; **alpha**
- [`ink-mde@0.34.0`](https://github.com/davidmyersdev/ink-mde) — hybrid GFM rendering, powers octo.app; no collab
- [ProseMark](https://prosemark.com/guides/getting-started/) (`@prosemark/core`) — CM6 extensions, Typora/Obsidian WYSIWYM; HyperMD CM6 successor
- [HyperMD](https://github.com/laobubu/HyperMD/issues/85): CM5, abandoned; CM6 fork incomplete. Comment on that issue: “Even Obsidian is using CodeMirror 5 for this reason.”

**Gotchas.** [y-codemirror.next#36](https://github.com/yjs/y-codemirror.next/issues/36): unmounted view can desync. Widget decorations (tables/math) must not own the text. [`@codemirror/collab`](https://codemirror.net/examples/collab/) is central-OT — worse fit than CRDT for webhook replay. Main branch of y-codemirror.next is Yjs v14 (`@y/codemirror`); stable is v13 + `0.3.6`.

**Comments.** No first-party threads. Persist `YRange` JSON server-side; render as `Decoration.mark` / gutter. Velt is a commercial CM6 comments SDK.

### 2. Overtype (`overtype@2.6.1`) — skip for collab

[Typora overlay](https://github.com/panphora/overtype): invisible textarea over preview; textarea is SoT. Authors list collab as out of scope. No CRDT binding; overlay alignment breaks with remote carets/widgets.

### 3. Lexical `@lexical/mdast` / React Markdown Kit — later WYSIWYG *view*

**Observed.** [`@lexical/mdast`](https://lexical.dev/docs/serialization/markdown-mdast) (experimental) preserves `_` vs `*`, fence style, setext vs ATX, list markers, hard-break style, table alignment via NodeState; +26 kB vs `@lexical/markdown`. Default `@lexical/markdown` is regex transformers; PRs [#8825](https://github.com/facebook/lexical/pull/8825), [#9055](https://github.com/facebook/lexical/pull/9055) still chasing fidelity.

[React Markdown Kit](https://reactmarkdownkit.com/docs/editor/round-trip) claims **22/22 byte-identical no-op round-trips** by copying original byte spans for untouched blocks; frontmatter/HTML/footnotes/math become opaque nodes. Serializer path is only 14/22 byte-identical (canonicalizes). Collab would still be a tree unless markdown remains SoT.

### 4. Milkdown `@milkdown/core@7.22.3` — do not use as CRDT doc

**Observed (maintainer, [#2157](https://github.com/Milkdown/milkdown/issues/2157)):** live model is ProseMirror. Remark/mdast only at import and export. [`@milkdown/plugin-collab@7.22.3`](https://www.npmjs.com/package/@milkdown/plugin-collab) = `y-prosemirror`, not `Y.Text`. “Markdown-first” is parse/serialize, not the collab document. Export canonicalizes emphasis, list markers, HTML, frontmatter. X: [DeMinds](https://x.com/DeMindsXYZ/status/2108952864857231662) — “Rich where it’s safe. Source where fidelity matters.”

### 5. Tiptap `@tiptap/markdown@3.31.4` — lossy

[Marked-based](https://tiptap.dev/docs/editor/markdown/getting-started/basic-usage). Docs: missing extensions drop content; no frontmatter; merged cells lost. **Observed:** table hardBreaks [#7731](https://github.com/ueberdosis/tiptap/issues/7731); escaped `|` in cells lost then destroys next parse ([#8294](https://github.com/ueberdosis/tiptap/issues/8294), still in 3.31.3). Empty paragraphs need `&nbsp;` hacks. Comments: paid `@tiptap-pro/extension-comments`, threads as **marks in the PM doc** — would pollute git if serialized.

---

## Round-trip (tree vs text)

| Construct | CM6 / Overtype | Milkdown / Tiptap / `@lexical/markdown` | `@lexical/mdast` / RMK editor |
|---|---|---|---|
| Frontmatter | preserved (text) | dropped | RMK: opaque node |
| `*` vs `_` | preserved | canonicalized | NodeState / byte spans |
| List `-`/`*`/`+` | preserved | canonicalized | preserved on mdast |
| Hard breaks | preserved | often normalized | NodeState |
| Reference links | preserved | often broken | RMK audit case |
| HTML / comments | preserved | flatten or drop | opaque |
| Tables | preserved | Tiptap pipe-escape data loss | GFM alignment on mdast |
| Fences `` ``` `` vs `~~~` | preserved | canonicalized | preserved on mdast |

---

## Production products

| Product | Editor | Git/md SoT? | Fidelity |
|---|---|---|---|
| **HedgeDoc 1** | CM + OT.js on markdown | Yes | Closest analog. Maintenance-only. |
| **HedgeDoc 2** | CM + Yjs `Y.Text` (alpha rewrite) | Yes | Same architecture as v1 here. |
| **GitBook** Git Sync | Block editor | Bidirectional md, **rewrites** `-`→`*`; non-flavor markup reverted ([git-sync-normalization](https://github.com/GitbookIO/git-sync-normalization)) | Lossy by design |
| **Outline** | PM + Yjs | Stores PM JSON + ydoc; md is import/export. Comments = **PM marks** ([#12322](https://github.com/outline/outline/pull/12322)). Trailing-node canonicalize caused spurious diffs ([#12620](https://github.com/outline/outline/pull/12620)) |
| **Docmost** | Tiptap + Hocuspocus | Canonical = Tiptap JSON + ydoc; md via Turndown | Not git-md SoT |
| **TinaCMS** | visual MDX | Git files, **not realtime**. Load/save corrupts braces, code-block meta, MDX comments ([#6651](https://github.com/tinacms/tinacms/discussions/6651), [#6653](https://github.com/tinacms/tinacms/issues/6653)) |
| **Decap CMS** | Slate + remark@10; markdown widget [deprecated](https://decapcms.org/docs/widgets/markdown/) | Git commits, not collab. remark-stringify canonicalizes |

---

## Collab cursors & comments

- **Text CRDT:** cursors = awareness; comments = `Y.RelativePosition` / Loro Cursor **server-side**. Survive concurrent edits and git-diff replay. Never write marks into the file.
- **PM / Tiptap / Milkdown / Outline:** comments as marks inside the tree — fights “never in the file” and webhook replay. y-prosemirror [CAVEATS](https://github.com/yjs/y-prosemirror/blob/master/CAVEATS.md): overlapping same-type marks are unordered across peers.

---

## Recommendation

**v1:** CodeMirror 6 (`markdown()`) bound to `Y.Text` via `y-codemirror.next@0.3.6` (or Loro if you want first-party cursors). Split-pane preview first; add `codemirror-live-markdown` or ProseMark decorations only where they don’t replace the source. Comments as `YRange` JSON in your DB. This is HedgeDoc’s model — the only production system that collabs on git-shaped markdown.

**Later:** richer live preview; optional Lexical/`@lexical/mdast` or React Markdown Kit as a *view* that writes dirty-region markdown — never as the CRDT.

**Skip:** Overtype for collab; GitBook-style canonicalizers; Milkdown/Tiptap/Outline trees on the wire; comments as markdown HTML or PM marks.

*[INFERENCE] Dual-mode (CM source + Lexical view on one `Y.Text`) is feasible but not observed as a shipped product. X discussion of CM×PM dual-binding: https://x.com/nick_mune0127/status/2021792399337697781*
