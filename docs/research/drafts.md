# Drafts next to live editing — prior art (2026-10-25)

Question: how do writing tools combine Google-Docs-style live editing with private drafts that merge back? Red Letter wants both.

## The Ink & Switch argument

No Ink & Switch talk is titled "you don't need Google Docs". The source is **Upwelling** (March 2023): *Combining real-time collaboration with version control for writers* — McKelvey, Jenson, Wagner, Cook, Kleppmann. [Essay](https://www.inkandswitch.com/upwelling/) · [demo](https://upwelling-prototype.netlify.app/) · [Kleppmann's copy](https://martin.kleppmann.com/2023/03/09/upwelling-version-control-for-writers.html)

- "Real-time collaboration in cloud applications like Google Docs can create stress when writers feel watched by their co-authors." They call it the **fishbowl effect**. Writers work around it with airplane mode, AutoSave off, or a copy of the doc pasted back later.
- Same interviews as [Peritext](https://www.inkandswitch.com/peritext/) (2021): writers "felt performative, self-conscious of others witnessing their messy work-in-progress".
- Geoffrey Litt, [Contemplation and Collaboration with CRDTs](https://buttondown.com/geoffreylitt/archive/contemplation-and-collaboration-with-crdts/) (2021): "I find it unnerving to do deep writing in a publicly visible place… there aren't nice ways to go try out an edit before committing to it publicly."
- Talk: Kleppmann, Strange Loop 2023, [New algorithms for collaborative text editing](https://martin.kleppmann.com/2023/09/22/strange-loop.html): "How can we combine ideas from version control, such as branches and pull requests, with real-time sharing?"

Their conclusion: live editing is good **when you opt in**. Keep it, and add drafts.

## Upwelling

- Every edit lives in a titled **layer**. Unmerged layers are drafts; merged layers form a linear stack.
- Live collaboration works *inside* a shared draft. Drafts don't see each other until merged.
- **Show changes** is a toggle. Inserts are tinted; deletions are a small mark you hover to read, so there's no strikethrough wall.
- Merging is whole-draft. Anyone can merge: the process is social, not an ACL. A merged layer is frozen.
- **Drafts float on main**: after a merge, the other drafts get its changes (a rebase). The writer isn't interrupted: a "pending changes" notice, applied when they choose. After applying, the draft shows exactly what main would look like if it merged now.
- Conflicts: CRDT auto-merge, which can interleave (`frostysoft`). They chose human review over a conflict UI.
- Lessons: no nested drafts, no cherry-pick or squash, keep drafts small and merge them early.

## Patchwork (2024)

[Lab notebook](https://www.inkandswitch.com/patchwork/notebook/2024-version-control/). Upwelling felt too ceremonial (you had to make a layer before typing), so Patchwork made formality optional.

- [06 Simple branching](https://www.inkandswitch.com/patchwork/notebook/2024-version-control/06/): one branch picker; main is the default; branch only from main and merge only into main; names optional; merging deletes the branch; share a branch by link. **Retroactive branching**: move the current session's edits off main into a branch.
- [04 Diffs](https://www.inkandswitch.com/patchwork/notebook/2024-version-control/04/): hover to see deleted text, a minibar marking where things changed, word counts rather than character counts.
- [05 Edit groups](https://www.inkandswitch.com/patchwork/notebook/2024-version-control/05/): group related edits after the fact; revert a group.
- [07 AI as branches](https://www.inkandswitch.com/patchwork/notebook/2024-version-control/07/): bots edit on branches, humans merge.
- [08 Automerge](https://www.inkandswitch.com/patchwork/notebook/2024-version-control/08/): branches are Automerge clones; merging is a CRDT merge. Git isn't involved.

## Shipping products

| Product | Draft model | Takes main's new edits | Merge |
|---|---|---|---|
| Google Docs [Suggesting](https://support.google.com/docs/answer/6033474) | mode on the shared doc, still a fishbowl | n/a | per-span accept/reject |
| [Figma branches](https://help.figma.com/hc/en-us/articles/360063144053-Guide-to-branching) | named copy, live inside | "Update from main", all or nothing | review overlay, conflict UI; comments don't travel |
| [GitBook change requests](https://gitbook.com/docs/collaborate/change-requests) | in-app branch, live inside | yes | review, then one commit |
| [Ellipsus](https://help.ellipsus.com/support/solutions/articles/205000067235-understanding-documents-and-drafts) | drafts inside a doc | no: drafts freeze and drift | draft overwrites main |
| [Lix](https://lix.dev/docs/branching) | SQL-backed versions | `mergeBranchPreview` | merge |
| [Jazz](https://classic.jazz.tools/docs/vanilla/key-features/version-control) | `unstable_branch`, privacy via owner group | — | `unstable_merge`, last writer wins per field |

Engines: Automerge has `clone` + `merge` (what Patchwork uses); Loro has `fork`/`forkAt`/`checkout`; Yjs has no branches (fork the whole doc; [updates can't be cherry-picked](https://discuss.yjs.dev/t/document-branches-like-git-branches/697)).

## What Red Letter takes

Git stays canonical (see `prior-art-patchwork-git-bridges.md`), so a draft is a **real git branch**, not an Automerge clone:

- Main stays live. A draft is opt-in, created from the branch picker (Patchwork), and it's live inside too: anyone with the link edits it with you.
- Taking main's new edits is never automatic (Upwelling): "Update from main" shows when main moved. It's a CRDT merge, like an agent push, so overlaps get flagged instead of git conflict markers.
- "Changes" toggles the draft's diff against main (Upwelling's Show changes).
- Merging lands what was reviewed: if main moved since the last update, Merge pulls main in first and asks for another look. Merging deletes the draft branch (Patchwork).
- Skipped: retroactive drafts, private drafts (GitHub can't hide a branch from people who can read the repo), nested drafts, cherry-pick, and comments carried across on merge.
