# Patchwork, Automerge, and git↔CRDT prior art

**Truth models:** I&S work is **CRDT-as-truth** (disk/git, if any, is a projection). Jupyter RTC is the closest **git/disk-as-truth + CRDT live layer**. No production **git remote helper** for Automerge was found.

## 1. Patchwork (Ink & Switch, Project 030, 2024–2026)

**What it is.** Research into “universal / malleable version control” for writing and other media, built on Automerge. Lab notebook: [inkandswitch.com/patchwork/notebook](https://www.inkandswitch.com/patchwork/notebook/). Project: [inkandswitch.com/project/patchwork](https://www.inkandswitch.com/project/patchwork/). Runtime code: [inkandswitch/patchwork-system](https://github.com/inkandswitch/patchwork-system) (Automerge docs as a virtual FS, not git).

**Branching / history (observed).** Automerge is the store: never-delete change log, per-character IDs, exact diffs between any two heads ([08 · History and diffs](https://www.inkandswitch.com/patchwork/notebook/2024-version-control/08/)). UI branching is **not git**: only branch from `main`, no nested branches; unnamed/AI-named branches; merge deletes the branch; you can retroactively peel the current session off `main` ([06 · Simple branching](https://www.inkandswitch.com/patchwork/notebook/2024-version-control/06/)). Default is edit-on-main.

**Git import/export.** **Not observed.** Git is analogy/UX inspiration. Filesystem interop is Automerge↔Unix dir via **pushwork**, not git. Geoffrey Litt (X): they experimented with syncing a Unix FS to an Automerge repo while extending Patchwork branching ([tweet](https://x.com/geoffreylitt/status/1825522043619594375)).

**Predecessor — Upwelling (2022–23).** [Essay](https://www.inkandswitch.com/upwelling/). **CRDT-as-truth.** Layers/drafts float on a merged “stack” (git rebase analog); Automerge + ProseMirror; async via tarball upload; `?download` Automerge blob, not git. They explicitly rejected git-like dependent branches as too hard. Syntactic CRDT merge of concurrent word replacements can concatenate (`frostysoft`); they rely on human review.

**Jacquard (2024).** [Project](https://www.inkandswitch.com/project/jacquard/) / [notebook](https://www.inkandswitch.com/jacquard/notebook/). Patchwork + provenance for papers (LaTeX/Python). Still Automerge-as-truth, not git-as-truth.

## 2. automerge-repo and “git bridges”

**automerge-repo** ([github.com/automerge/automerge-repo](https://github.com/automerge/automerge-repo), [blog](https://automerge.org/blog/automerge-repo/)): multi-doc wrapper with pluggable `IndexedDB` / `NodeFSStorageAdapter` and WebSocket/BroadcastChannel adapters. Stable npm around **2.5.x**; GitHub also has **2.6.0-alpha** and **3.0.0-experimental** (version listings conflict — treat as observed-with-noise). **CRDT-as-truth.** Not a git remote.

**No git-remote-automerge / git remote helper** turned up in web or X search. X: I&S talk is Keyhive/Beelay/Patchwork, not git remotes.

**pushwork** ([inkandswitch/pushwork](https://github.com/inkandswitch/pushwork)) — closest I&S FS bridge. **CRDT-as-truth; disk is a materialization.** Per-file Automerge docs under a root folder doc (`automerge:` URL); `sync` diffs working tree → file docs, Automerge-merges peers, writes back to disk. Ignores `.git`. Shapes: `vfs` and `patchwork-folder`. Text = character CRDT; binary = LWW. `yeet`/`yoink` push/pull one file doc. Artifacts skip char-diff (contentHash + new doc). **Gotcha:** large splices are expensive; don’t clear a deleted file with a giant splice.

**Keyhive / Beelay / Subduction.** [Keyhive](https://www.inkandswitch.com/project/keyhive/) is capability/E2EE access control for local-first data “**like Automerge and Git**” — Git named as a *data model that capabilities could wrap*, not a CRDT↔git converter. Beelay ([automerge/beelay](https://github.com/automerge/beelay)): encrypted RPC sync for hash-linked DAGs; Subduction is the successor relay (pushwork default `wss://subduction.sync.inkandswitch.com`). **CRDT/sync-as-truth.**

## 3. Git-as-canonical + CRDT live layer (others)

| Project | Truth | Notes |
|---|---|---|
| **Jupyter RTC** ([jupyter-collaboration](https://jupyterlab-realtime-collaboration.readthedocs.io/en/latest/developer/architecture.html), [jupyter_ydoc](https://github.com/jupyter-server/jupyter_ydoc)) | **Disk/file-as-truth** (git-friendly `.ipynb`/text); Yjs/pycrdt is live; `.jupyter_ystore.db` is sidecar history (git-ignore) | Closest analog. Early Automerge attempt archived. Autosave to disk; poll/OOB reload. |
| Obsidian LiveSync ([vrtmrz/obsidian-livesync](https://github.com/vrtmrz/obsidian-livesync)) | **CouchDB-as-truth** | Not git. `obsidian-git-livesync` is one-way git→CouchDB. [obsidian-crdt-sync](https://github.com/yegor-usoltsev/obsidian-crdt-sync): Yjs live, **optional git backup** (CRDT-as-truth). |
| VS Code Live Share | **Session-as-truth** | Not a CRDT-over-git file layer. |
| git-warp | **Git objects store CRDT ops** | Graph CRDT *in* git refs, not vanilla markdown files as truth. |

Jupyter gotchas (observed): mtime-only OOB detection reloaded the whole notebook on `touch` ([issue #509](https://github.com/jupyterlab/jupyter-collaboration/issues/509)); `YNotebook.set()` duplicated cells when YStore vs disk order diverged ([PR #376](https://github.com/jupyter-server/jupyter_ydoc/pull/376)); `YArray.move` is Yrs/Yjs 14, **incompatible with Yjs 13** binary; Unicode byte vs char offsets ([PR #370](https://github.com/jupyter-server/jupyter_ydoc/pull/370)).

## 4. Replaying an external file diff into a CRDT

This is the product’s webhook path (old blob vs new blob → CRDT ops).

- **Automerge.updateText(doc, path, newText)** — [docs](https://automerge.org/docs/reference/documents/text/), API **@automerge/automerge v3.5.0** (beta). Myers-style diff → `splice`. [Merry Commitmas](https://automerge.org/blog/merry-commitmas/): built-in because capturing keystrokes is hard. **Gotcha (primary):** “works best when you call it as frequently as possible”; large batched diffs “will not merge well with concurrent changes.” Wholesale string replace = delete-all+insert-all, concurrent browser edits interleave badly.
- **Y.Text** has no built-in string diff. Community: `fast-diff` → `ytext.applyDelta` ([discuss #2358](https://discuss.yjs.dev/t/plain-text-input-component-with-y-text/2358)). Ambiguous repeats (`foofoo`→`foofoofoo`) pick an arbitrary end. Overwrite of two independent Y.Docs duplicates ([discuss #2538](https://discuss.yjs.dev/t/merging-two-different-y-js-documents/2538)).
- **jupyter_ydoc** `YUnicode` reload: Python `difflib.SequenceMatcher` granular insert/delete vs full reset ([commit 87e2052 / PR #366](https://github.com/jupyter-server/jupyter_ydoc/commit/87e205209dbfed2d367424e6913c88916e77d98e)). Notebooks: identity-preserving cell reorder, not “wipe and rewrite.”

**[INFERENCE]** A GitHub webhook should: diff **old blob → new blob** (not “CRDT snapshot vs new blob”), apply that as splices/`updateText` on the live doc so concurrent browser ops still commute. Commit-on-idle must not echo the same bytes back as a second splice (origin tag / skip if equal).

## Recommendation

Do not copy Patchwork’s data model: Automerge *is* history there, git is not in the loop, and their “branches” are Automerge clones with a deliberately non-git topology. Use git branches as git branches. Closest production lesson is Jupyter: **plain files on git are canonical; CRDT is an ephemeral working copy per (path, branch); OOB git pushes are applied as a text/cell diff into the live Y/Automerge doc, never as a document replace.** Implement that with `Automerge.updateText` (or `fast-diff` → Y.Text delta) on the webhook, keep comments in a side store keyed by CRDT positions, and treat pushwork only as evidence that I&S already diff disk→CRDT (but with inverted truth). Skip Keyhive/Beelay until you need E2EE.
