// Where did one side (agent replay, or the humans) change the text since a base version, and where do two sides
// overlap? Hunks come from Automerge's own diff (base heads -> side heads), so they match the ops actually merged.
// Results are ranges in the doc's *current* text, plus the base text each range replaced.
import * as A from "@automerge/automerge";
import type { TextDoc } from "./replay.ts";

type Hunk = { s: number; e: number }; // base-text range [s, e); s === e is a pure insertion point
export type Region = { from: number; to: number; before: string };

const isWord = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}_]/u.test(c);
// Automerge diff patches are sequential and ascending; turn them into base-coordinate ranges. Hunks closer than
// `gap` chars on the same line merge, so a rewritten sentence reads as one change, not seven word-level ones,
// unless one of `blockers` (someone else's edits) sits in between: a merged range must only hold this side's text.
function hunks(patches: A.Patch[], base: string, gap = 0, blockers: Hunk[] = []): Hunk[] {
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
    const near = prev && s - prev.e <= gap && !base.slice(prev.e, s).includes("\n") && !blockers.some((b) => b.e >= prev.e && b.s <= s);
    if (prev && (s <= prev.e || near)) prev.e = Math.max(prev.e, e);
    else out.push({ s, e });
    offset += p.action === "splice" ? p.value.length : -len;
  }
  return out;
}

const touches = (a: Hunk, b: Hunk) =>
  (a.s < b.e && b.s < a.e) || a.s === b.s || (a.s === a.e && b.s < a.s && a.s < b.e) || (b.s === b.e && a.s < b.s && b.s < a.e);

// Map base-coordinate hunks into the current text via cursors on base characters.
function toCurrent(doc: A.Doc<TextDoc>, baseDoc: A.Doc<TextDoc>, hs: Hunk[]): Region[] {
  const base = baseDoc.text;
  const pos = (i: number, move: "before" | "after") =>
    i >= base.length ? doc.text.length : A.getCursorPosition(doc, ["text"], A.getCursor(baseDoc, ["text"], i, move));
  return hs.map((h) => ({ from: h.s === 0 ? 0 : pos(h.s - 1, "after") + 1, to: pos(h.e, "before"), before: base.slice(h.s, h.e) }));
}
// Regions one side changed between baseHeads and sideHeads, trimmed to the text that actually differs.
// otherHeads: the concurrent side (humans), whose edits must not end up inside a merged region.
export function editRegions(doc: A.Doc<TextDoc>, baseHeads: A.Heads, sideHeads: A.Heads, otherHeads?: A.Heads): Region[] {
  const baseDoc = A.view(doc, baseHeads);
  const others = otherHeads ? hunks(A.diff(doc, baseHeads, otherHeads), baseDoc.text) : [];
  return toCurrent(doc, baseDoc, hunks(A.diff(doc, baseHeads, sideHeads), baseDoc.text, 12, others))
    .map((r) => {
      const after = doc.text.slice(r.from, r.to);
      let p = 0;
      while (p < r.before.length && p < after.length && r.before[p] === after[p]) p++;
      let q = 0;
      while (q < r.before.length - p && q < after.length - p && r.before.at(-1 - q) === after.at(-1 - q)) q++;
      return { from: r.from + p, to: r.to - q, before: r.before.slice(p, r.before.length - q) };
    })
    .filter((r) => r.to > r.from || r.before);
}

export type Conflict = Region & { human: string; agent: string };

// Regions where both sides touched the same words since baseHeads, with each side's own version of the region
// so the UI can offer "keep yours" / "keep the agent's" instead of the interleaved merge.
export function findConflicts(doc: A.Doc<TextDoc>, baseHeads: A.Heads, humanHeads: A.Heads, agentHeads: A.Heads): Conflict[] {
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
  const side = (heads: A.Heads) => {
    const v = A.view(doc, heads);
    return toCurrent(v, baseDoc, regions).map((r) => v.text.slice(r.from, r.to));
  };
  const [humanText, agentText] = [side(humanHeads), side(agentHeads)];
  return toCurrent(doc, baseDoc, regions).map((r, i) => ({ ...r, human: humanText[i], agent: agentText[i] }));
}
