# CRDTs in production (2022–2026) — what teams run, what broke, what it means for us

Researched 2026-10-13, starting from Notion's [How Notion handles concurrent editing with CRDTs](https://www.notion.com/blog/how-notion-handles-concurrent-editing-with-crdts) (2026-09-18). Three parallel surveys: text editors, critiques/library status, agents × git. Unverified claims are marked [INFERENCE].

## Headline

- **Text editors split down the middle.**
  - CRDT holdouts: Notion, Zed, Apple Notes, Linear (text only), Jupyter, AFFiNE, Relay, Tiptap.
  - Moved to server ordering or OT: Figma, Liveblocks, Microsoft Fluid, Logseq, tldraw, Zero, Electric, Cinapse.
  - The reasons for leaving are memory and tombstones, debuggability, permissions, and "merges read as corruption". None of them is "CRDTs don't converge".
- **For agents, everyone independently landed on one rule: diff the agent's output against a private base, never the live doc.** Sim, Moment, Zed (`base_version`) and Relay (an LCA, last common ancestor) all do it. That is our replay-at-heads. Several learned it by clobbering users first.
- **Nobody else replays git commits deterministically across many tabs** [INFERENCE: absence in search]. We have no prior art to lean on for that piece. Fuzz it.
- **Our `changeAt` bug is upstream issue [automerge#1270](https://github.com/automerge/automerge/issues/1270)** ("ChangeAt + clone causes duplicate splice results", open since 2026-01, ~5/10 failures). A fix is pending in PR #1295. Our fork-at-heads + `applyChanges` path avoids it.

## Who runs what

| product | merge model | library | notes |
|---|---|---|---|
| [Notion](https://www.notion.com/blog/how-notion-handles-concurrent-editing-with-crdts) | CRDT, server-stored (Postgres) | own RGA + [Peritext](https://www.inkandswitch.com/peritext/) | Prod since 2025-07, "millions of ops/min". Replaced per-block last-write-wins (LWW). "Text slices / instances / search labels" handle block splits. Tombstones kept; no GC mentioned. Admits intent isn't always preserved. Agents can "suggest edits", approved one by one ([2026-08-28](https://www.notion.com/releases/2026-08-28)) |
| [Zed](https://zed.dev/blog/crdts) / [DeltaDB](https://zed.dev/blog/introducing-deltadb) | CRDT | own | Op-level version control ("every operation, not just every commit"); public beta 2026-09-16. Agents work in an isolated checkout and land via review ("Last Turn", per-person "Seen"). Git is the bootstrap and checkpoints |
| [Figma code layers](https://www.figma.com/blog/building-figmas-code-layers/) | server merges | [Eg-walker](https://arxiv.org/abs/2409.14252) | LWW "breaks down… worse when AI models made simultaneous edits". CRDT state exists only during the merge |
| Figma canvas | server-authoritative LWW per property | own | [2.2B changes/day](https://www.figma.com/blog/making-multiplayer-more-reliable/) |
| Linear | server total order; Yjs for descriptions | Yjs | Full-content API writes are diffed into minimal updates ([thread](https://x.com/artman/status/1733419888654291102), partially verified). Agent edits highlighted, with checkpoint restore ([2026-07-23](https://linear.app/changelog/2026-07-23-agent-assisted-editing)) |
| [Liveblocks LiveText](https://liveblocks.io/blog/livetext-a-new-data-type-for-collaborative-text-editing) | server OT | own | Left Yjs in 2026-09 over tombstone growth and opaque binary state; 2 MB/text cap |
| [Microsoft Fluid / Loop](https://fluidframework.com/docs/concepts/tob) | total-order broadcast | SharedString | Server sequence numbers |
| [tldraw sync](https://github.com/tldraw/tldraw/blob/main/packages/sync-core/DOCS.md) | server push/rebase | own | Incompatible clients must reload |
| [Logseq](https://github.com/logseq/logseq/pull/12315) | server order (Durable Objects), client rebase | own | Dropped RTC; checksums detect divergence |
| [Cinapse](https://powersync.com/blog/why-cinapse-moved-away-from-crdts-for-sync) | left Automerge 2 for PowerSync | — | 4 GB wasm limit on long-lived docs, ~$1k/mo per big customer; support −89%, hosting −66% after |
| Apple Notes | CRDT | own "topotext" | [Reverse-engineered](https://github.com/dunhamsteve/notesutils/blob/master/notes.md). 3rd-party clients that write positional diffs duplicate notes |
| [JupyterLab RTC](https://github.com/jupyterlab/jupyter-collaboration/issues/545) | CRDT | Yjs / pycrdt | Doc/cell duplication when disk and YStore diverge. Fixed by **deterministic** init update ([#571](https://github.com/jupyterlab/jupyter-collaboration/pull/571)) |
| [AFFiNE](https://github.com/y-crdt/y-octo) | CRDT | Yjs client, y-octo server | An encoding mismatch between implementations broke clients |
| [Tiptap](https://tiptap.dev/docs/ai/ai-toolkit/agents/tracked-changes) | CRDT | Yjs | AI edits stored as tracked-change marks; accept/reject (alpha) |
| [Relay (Obsidian)](https://relay.md/releases) | CRDT | Yjs | Ingests disk edits via diff3 from LCA (2026-09). "Doesn't judge whether they make sense together". diff3 ~2 s at 50 KB |
| [Moment](https://www.moment.dev/blog/collab-with-ai-is-hard) | no CRDT; markdown in git | prosemirror-collab | Agents edit `.md`; the diff becomes suggestions. AI is isolated from user writes until done. 20–30% of offline conflicts read as "corruption" ([pt1](https://www.moment.dev/blog/lies-i-was-told-pt-1)) |
| [Sim](https://www.sim.ai/blog/agent-as-yjs-peer) | CRDT | Yjs | v1 set the doc to agent text and wiped edits. Fix: shadow doc, diff per chunk, agent origin kept off the undo stack |
| [Proof (Every)](https://github.com/EveryInc/proof-sdk/blob/main/docs/agent-docs.md) | CRDT + optimistic lock for agents | Yjs | `baseRevision` → `409 STALE_BASE`; full rewrites blocked while clients are live; provenance rail |
| [Ink & Switch Patchwork](https://www.inkandswitch.com/patchwork/notebook/2024-version-control/) | CRDT | Automerge | Bots edit on branches, humans merge selectively. An agent joined as a plain peer ([lm-08](https://www.inkandswitch.com/livelymerge/notebook/lm-08/), 2026-09) |

Critiques worth reading:
- Weidner, [Text without CRDTs or OT](https://mattweidner.com/2025/05/21/text-without-crdts.html) (2025): server-ordered "insert after ID". The server may flag a conflicting op or turn it into a suggestion. Weidner is also a Notion contributor.
- Moment, [Lies I was told pt 2](https://www.moment.dev/blog/lies-i-was-told-pt-2) (2026): y-prosemirror full rebuilds, schema-mismatch deletions that propagate, GC vs. history.

## External file edits → CRDT (closest prior art to our replay)

| system | diff | base | overlap handling |
|---|---|---|---|
| [Zed](https://github.com/zed-industries/zed/blob/main/crates/language/src/buffer.rs) | line diff, then word diff for small hunks | buffer `base_version` | **drops hunks that intersect concurrent edits**; never reloads a dirty buffer |
| [Relay](https://github.com/No-Instructions/Relay/tree/main/src/merge-hsm) | diff3 from stored LCA → diff-match-patch | last agreed version | same lines → user chooses; CRLF→LF |
| [Jupyter ydoc](https://github.com/jupyter-server/jupyter_ydoc/blob/main/jupyter_ydoc/yunicode.py) | SequenceMatcher | live doc | below a similarity threshold, full replace (bloat, [#243](https://github.com/jupyterlab/jupyter-collaboration/issues/243)) |
| [Teamtype](https://github.com/teamtype/teamtype/blob/main/crates/teamtype/src/document.rs) | char diff | live doc | none |
| [pushwork](https://github.com/inkandswitch/pushwork/blob/main/src/shapes/file.ts) | Automerge `updateText` | local doc | none |
| [MDArena](https://github.com/AliOsm/MDArena) | — | — | invalidates CRDT state on external push [INFERENCE] |
| **Red Letter** | Automerge `updateText` (char) | **recorded heads of parent commit, deterministic across tabs** | flag (`findConflicts`) |

## What this changes for Red Letter

Confirmed as designed:
- Replay against a private base: Sim, Moment, Zed and Relay all reached it the hard way.
- Agents edit plain markdown through git: Moment's models are bad at emitting ops or patches; Zed and Figma also keep agents on files.
- `updateRefs` CAS as the ordering authority: Figma, Notion, Linear, Fluid and Zero all order on a server. For us git plays that role, in the same shape as Proof's `409 STALE_BASE` retry.
- No ProseMirror tree as the doc: schema-mismatch data loss in Yjs, Tiptap and AFFiNE.
- Conflict flags, which most bridges lack. Relay "doesn't judge", Teamtype and pushwork just merge.

New work, roughly by priority:
1. **Replay determinism is a cross-version contract.**
   - The change bytes depend on the Automerge version, the diff algorithm and the actor recipe. Mixed builds would duplicate text.
   - Pin `@automerge/automerge` exactly.
   - Put `replayVersion` in `meta.json` and the trailer; a tab seeing a newer version reloads instead of replaying (tldraw does the same).
   - Jupyter's duplication bugs are this failure mode.
2. **The relay can inject ops.** Anyone holding a docId can push changes that an honest tab later commits under its own name. Production systems all enforce permissions at an authority. Stateless fix: the relay checks the GitHub token's access to the repo on connect.
3. **Fuzz the replay.** Random human/agent traces, N tabs, random poll timing. Assert identical heads, no duplicated text, and a flag on every overlap (Loro and Articulated do this). Nobody else has run this path in production.
4. **Agent push UX** (Linear, Delta, Notion):
   - Apply the push, highlight its hunks keyed by commit sha (cursor pairs, like conflict regions).
   - Per-hunk Revert, which is just a human edit; per-person Seen.
   - Draft branch = suggestion mode.
   - Map replay actor → commit author so `getAuthors` and highlights can say "agent via abc123".
5. **Keep replayed changes off the human's undo stack** (Sim). Check `automerge-codemirror`'s undo handling. One Ctrl-Z must not undo an agent commit.
6. **Diff granularity experiment.** Zed's line → word diff instead of char-level `updateText`. It may shrink `pheople`-style garbage, though identical-fix duplicates (`GitHHub`) need overlap policy, not diffing. Fugue/Loro don't fix replace-vs-replace (Loro char merged identically in S1). Measure on S1 before switching.
7. **Overlap policy beyond flagging.** Zed and Weidner drop the overlapping agent hunk and offer it as a suggestion. For us that resolution can't be automatic in every tab, because it depends on live state and isn't deterministic. It has to be one user action that writes ordinary ops.
8. **Never fall back to "set doc = blob".** Jupyter bloat, MDArena wiping, Sim's v1. If replay fails, flag and stop.
9. **Growth.** Automerge 3's compressed in-memory format fixes what killed Cinapse on Automerge 2. Still track snapshot size per file. Compact only at a commit with no open flags, re-anchoring comments via the context fallback.
10. **Off the main thread.** Replay (~380 ms) and `findConflicts` (~560 ms) at 60 KB go in a worker (Moment: "conflict resolution never on main thread").
11. **EOL.** Honour `.gitattributes`, `core.eol` and `core.autocrlf` (Delta does).

Not changing: Automerge stays. Yjs v14's attribution and accept/reject is attractive but still RC (`@y/y@14.0.0-rc.7`), and Yjs GC fights the history we key on. Loro had no merge-quality edge in S1 and few named production users.

Not changing either: polling latency. Delta, Moment, GitBook and Notion's suggestions all batch agent work into reviewable units. A ~15 s agent→browser lag fits that model.
