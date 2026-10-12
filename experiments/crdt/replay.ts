// The git -> CRDT primitive, as the prototype should implement it. Runs in Bun and the browser.
//
// Apply an external commit (agent push) to the live doc *at the heads that correspond to the parent commit*.
// - Fork at heads with an actor derived from (fromCommit, toCommit) and a fixed timestamp, so every tab that
//   replays the same transition produces a byte-identical change; the CRDT dedupes it.
// - applyChanges instead of changeAt: in automerge 3.5.0 changeAt's materialized doc/patches are wrong for
//   concurrent text edits ~half the time (see changeat-bug.ts); the underlying state is fine.
import * as A from "@automerge/automerge";

export type TextDoc = { text: string };

// 16-byte actor from two commit shas (hex). Unique per transition within a doc.
export const replayActor = (fromCommit: string, toCommit: string) => fromCommit.slice(0, 16) + toCommit.slice(0, 16);

export function replay<T extends TextDoc>(
  live: A.Doc<T>,
  heads: A.Heads,
  fromCommit: string,
  toCommit: string,
  blob: string,
  patchCallback?: A.PatchCallback<T>,
): { doc: A.Doc<T>; change: Uint8Array | undefined; heads: A.Heads } {
  const fork = A.clone(A.view(live, heads), { actor: replayActor(fromCommit, toCommit) });
  const done = A.change(fork, { time: 0, message: `red-letter replay ${fromCommit}..${toCommit}` }, (d) =>
    A.updateText(d, ["text"], blob),
  );
  const change = A.getLastLocalChange(done);
  if (!change) return { doc: live, change, heads }; // blob unchanged for this file
  const [doc] = A.applyChanges(A.clone(live), [change], { patchCallback });
  return { doc, change, heads: [A.decodeChange(change).hash] };
}
