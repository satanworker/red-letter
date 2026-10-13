// The git -> CRDT primitive. Runs in Bun and the browser.
//
// Apply an external commit (agent push) to the live doc *at the heads that correspond to the parent commit*.
// - Fork at heads with an actor derived from (fromCommit, toCommit) and a fixed timestamp, so every tab that
//   replays the same transition produces a byte-identical change; the CRDT dedupes it.
// - applyChanges instead of changeAt: automerge 3.5.0 changeAt materializes wrong text with concurrent edits
//   (upstream automerge#1270; repro in experiments/crdt/changeat-bug.ts).
import * as A from "@automerge/automerge";

export type TextDoc = { text: string };

// Change bytes depend on this recipe, the Automerge version (pinned exactly) and updateText's diff. Bump on any
// change to them; tabs refuse to replay into a snapshot written by a newer version (mixed builds duplicate text).
export const REPLAY_VERSION = 1;

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
