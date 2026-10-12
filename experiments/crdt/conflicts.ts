// Detect where an agent replay and concurrent human edits touched the same words, so the UI can flag the region
// ("you and the agent both changed this") instead of silently showing an interleaved merge.
// Hunks come from Automerge's own diff (base heads -> each side), so they match the ops actually merged.
import * as A from "@automerge/automerge";
import type { TextDoc } from "./replay.ts";

type Hunk = { s: number; e: number }; // base-text range [s, e); s === e is a pure insertion point

const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);

// Automerge diff patches are sequential and ascending; turn them into base-coordinate ranges.
function hunks(patches: A.Patch[], base: string): Hunk[] {
  const out: Hunk[] = [];
  let offset = 0;
  for (const p of patches) {
    if (p.path[0] !== "text" || (p.action !== "splice" && p.action !== "del")) continue;
    const at = Number(p.path[1]) - offset;
    const len = p.action === "splice" ? 0 : (p.length ?? 1);
    let s = at;
    let e = at + len;
    // widen to whole words: two edits inside the same word are the same edit for a reader
    while (s > 0 && isWord(base[s - 1]) && (len > 0 || isWord(base[s]))) s--;
    while (e < base.length && isWord(base[e]) && (len > 0 || isWord(base[e - 1]))) e++;
    const prev = out.at(-1);
    if (prev && s <= prev.e) prev.e = Math.max(prev.e, e);
    else out.push({ s, e });
    offset += p.action === "splice" ? p.value.length : -len;
  }
  return out;
}

const touches = (a: Hunk, b: Hunk) => a.s < b.e && b.s < a.e || a.s === b.s || (a.s === a.e && b.s < a.s && a.s < b.e) || (b.s === b.e && a.s < b.s && b.s < a.e);

// Returns conflict ranges in the merged doc's current text.
export function findConflicts(
  doc: A.Doc<TextDoc>,
  baseHeads: A.Heads,
  humanHeads: A.Heads,
  agentHeads: A.Heads,
): { from: number; to: number }[] {
  const baseDoc = A.view(doc, baseHeads);
  const base = baseDoc.text;
  const human = hunks(A.diff(doc, baseHeads, humanHeads), base);
  const agent = hunks(A.diff(doc, baseHeads, agentHeads), base);
  const regions: Hunk[] = [];
  for (const h of human)
    for (const a of agent)
      if (touches(h, a)) {
        const r = { s: Math.min(h.s, a.s), e: Math.max(h.e, a.e) };
        const prev = regions.at(-1);
        if (prev && r.s <= prev.e) prev.e = Math.max(prev.e, r.e);
        else regions.push(r);
      }
  const pos = (i: number, move: "before" | "after") =>
    i >= base.length ? doc.text.length : A.getCursorPosition(doc, ["text"], A.getCursor(baseDoc, ["text"], i, move));
  return regions.map((r) => ({ from: r.s === 0 ? 0 : pos(r.s - 1, "after") + 1, to: pos(r.e, "before") }));
}
