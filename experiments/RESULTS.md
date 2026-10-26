# Spike results — 2026-10-12

Verdict: **the serverless design holds.** Every primitive ran end to end in a real browser against GitHub. Three design changes came out of it (below). Nothing found blocks a prototype.

## What ran

| spike | how | result |e
|---|---|---|
| S1 merge quality | `crdt/merge-quality.ts`: 11 human-vs-agent scenarios. Compared against Loro and `git merge-file` | Automerge is as good as Loro char and better than git: ideal in 6/11 and acceptable in 2 more, where git conflicts in 8/11. Every bad merge gets flagged (see table) |
| S1b two tabs replay one push | `crdt/deterministic-replay.ts` | naive replay **duplicates** the agent's text. Deterministic replay produces byte-identical changes and converges |
| S1c comment anchors | `crdt/anchors-and-perf.ts` | cursors follow text through human edits, replays, save/load and tab merges. Deleted text is detectable. A re-initialised doc can't resolve old cursors (needs the quote fallback) |
| automerge bug | `crdt/changeat-bug.ts` | `changeAt` gives **wrong materialized text/patches ~47% of the time** (139/300) with a concurrent edit. Save/load is correct. The editor would show corrupted text |
| S2/S3 GitHub API | `github/` scripts, `github/FINDINGS.md` | CORS ok, CAS ok, custom refs ok, 304 polls free. Two surprises changed the commit sequence |
| S4 browser | `browser/` (CM6 + automerge-repo + relay + GitHub from the page), driven by headless Chromium | full loop passes, below |


## S1 merge table (Automerge = `crdt/replay.ts`, LF-normalised)

| scenario | git merge-file | automerge | loro char | loro line | flagged by `findConflicts` |
|---|---|---|---|---|---|
| disjoint paragraphs | ideal | ideal | ideal | ideal | - |
| both append at EOF | conflict | ok, sections not interleaved | same | same | flagged |
| same line, different words | conflict | ideal | ideal | WRONG | - |
| agent rewrites sentence, human fixes typo in it | conflict | `pheople` | `eeditor` | WRONG | flagged |
| agent rewrites sentence, human appends to it | conflict | reasonable | same | WRONG | - |
| agent deletes section human is editing | conflict | orphan `ever ` | same | same | flagged |
| agent moves section, human edits inside it | ideal | ideal | ideal | ideal | - |
| identical fix on both sides | ideal | `GitHHub` | same | WRONG | flagged |
| agent reformats list markers, human edits item | conflict | ideal | ideal | WRONG | - |
| agent CRLF→LF, human edits | conflict | ideal (raw CRLF: WRONG) | ideal | WRONG | - |
| human types in paragraph agent extends | conflict | ideal | ideal | ideal | - |

All four bad merges are flagged; there is one extra flag, on EOF appends, which is defensible. `findConflicts` widens Automerge's own diff hunks to word boundaries and intersects the two sides.

## S4 browser loop (all observed)

- Tab 1 opens a file it has never seen: it inits from the blob and claims the CRDT ref via `POST git/refs`.
- Tab 2 opens the same link **without** a doc id: it finds the doc through the CRDT ref and joins via the relay. Typing syncs.
- Concurrent edits in both tabs plus an agent `git push`; both tabs poll at the same instant and each replays independently. The two changes have the same hash (`b7386ab2`), the text has no duplication, CM equals the doc, and the overlap is highlighted in both tabs from cursors stored in the doc.
- Browser commit with REST: 5 calls, 2.6 s; GitHub content equals the doc. With GraphQL `updateRefs` (file + snapshot atomically): 7 calls, 4.0 s.
- CAS race: agent pushes, then the tab commits from a stale parent. REST gives 422 and `updateRefs` gives an opaque error. The tab polls, replays, retries and succeeds on attempt 2 with both edits in git.
- Relay killed (all in-memory state gone) and tabs closed. A cold tab loads the snapshot from GitHub with full history (36 changes), sees the trailer on the last browser commit and skips the replay. It then replays a new agent push correctly.
- Init race: two tabs open a new file at once. One gets 422 `Reference already exists`, loads the winner's snapshot, and both tabs end up on the same doc.
- Cleanup: `git ls-remote` shows only `main` at `b76867d`.

## Performance (60 KB doc, 5,000 keystroke changes, Bun on arm64)

| op | value |
|---|---|
| keystroke change | 0.3 ms |
| `A.save` size | 45 KB |
| `A.load` | 93–134 ms |
| replay (50 sections rewritten) | 360–390 ms |
| `findConflicts` | ~560 ms |
| replay in browser, small doc | 17–131 ms |
| bundle (automerge wasm inlined base64) | 6.3 MB unminified |

## Design changes (applied to `docs/DESIGN.md`)

1. **Replay primitive.** Fork at the recorded heads with actor `from[0:16] + to[0:16]`, set `time: 0`, run `updateText`, then `applyChanges` the result. Don't use `changeAt` (the bug above). Every tab that replays the same transition emits the same change. Replay **every first-parent commit** in order: skipping one gives a different change and duplicates text. Code: `crdt/replay.ts`.
2. **Commit = file + snapshot, atomically.** REST `PATCH` on `refs/red-letter/*` has no fast-forward/CAS check and silently overwrites. GraphQL `updateRefs` moves the branch and the snapshot ref together, with a real compare-and-swap on both. Any error means conflict: poll, replay, retry. Browser commits carry a `Red-Letter-Heads:` trailer. Tabs never replay those; if the heads are missing locally they merge the snapshot.
3. **Ref naming** is `refs/red-letter/v1/<sha1(branch)>/<sha1(path)>`, pointing at a parentless commit `{doc.automerge, meta.json}`. `<branch>/<path>` collides (`a`+`b/c.md` vs `a/b`+`c.md`) and hits directory/file ref conflicts.

Smaller rules:
- The CRDT holds LF. Restore the file's EOL on commit.
- Poll with `cache:"no-store"` and a manual `If-None-Match`. The default fetch serves refs from the browser cache for 60 s.
- Read files via `api.github.com/.../contents?ref=` with the raw media type. Authenticated `raw.githubusercontent.com` fails CORS.
- Conflict regions are stored in the doc as cursor pairs keyed by commit sha, so every tab and every reload shows them.

## Left for the prototype (not spiked)

- GitHub App user-to-server token: all runs used a classic PAT. Whether `updateRefs` is allowed for App tokens is [INFERENCE]. Check it first thing with the real App.
- OAuth exchange function (CORS on `login/oauth/access_token` confirmed absent, so it's required).
- Comments branch (mechanics proven in `github/FINDINGS.md` H). Not wired into the UI.
- An agent's `git push --mirror` deletes `refs/red-letter/*`. Document it. A deleted snapshot recovers as a fresh doc, which loses comment anchors (quote fallback).
- Bundle size: serve the `.wasm` file instead of base64 (Vite).

## Run
```sh
cd experiments && bun install
bun crdt/merge-quality.ts && bun crdt/deterministic-replay.ts && bun crdt/anchors-and-perf.ts && bun crdt/changeat-bug.ts
bun browser/server.ts   # http://localhost:5173/?repo=o/r&branch=b&path=p.md  (localStorage.gh_token = token)
```
