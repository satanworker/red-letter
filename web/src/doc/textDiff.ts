// What `text` changed from `base`, as regions of `text` (with the removed text in `before`), for review highlights.
// Lines first, then words inside the lines that differ: Myers on each, so the work is the size of the change, not the
// doc. Automerge did this through a scratch doc (from + updateText + cursors): ~1.6 s for an 8k-char post, every key.
import type { Region } from "./regions.ts";

type Hunk = { a0: number; a1: number; b0: number; b1: number }; // a[a0, a1) became b[b0, b1)

// Myers' O((N+M)·D) diff of two token lists, as hunks in order.
function myers(a: string[], b: string[]): Hunk[] {
  const n = a.length, m = b.length, max = n + m;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  let found = n === 0 && m === 0;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[max + k - 1]! < v[max + k + 1]!) ? v[max + k + 1]! : v[max + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) x++, y++;
      v[max + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  // walk back through the trace, collecting the non-diagonal stretches
  const hunks: Hunk[] = [];
  let x = n, y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const t = trace[d]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && t[max + k - 1]! < t[max + k + 1]!) ? k + 1 : k - 1;
    const px = t[max + prevK]!, py = px - prevK;
    while (x > px && y > py) x--, y--; // the diagonal after the step
    const h = hunks[0];
    if (h && h.a0 === x && h.b0 === y) (h.a0 = px), (h.b0 = py);
    else hunks.unshift({ a0: px, a1: x, b0: py, b1: y });
    x = px;
    y = py;
  }
  return hunks;
}

const lines = (s: string) => s.match(/[^\n]*\n|[^\n]+$/g) ?? [];
const words = (s: string) => s.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
const starts = (parts: string[], from: number) => {
  const out = [from];
  for (const p of parts) out.push(out[out.length - 1]! + p.length);
  return out;
};

// How alike two lines are: Dice over their words, so a rewritten paragraph pairs with its old self and a removed one
// pairs with nothing (word-diffing unrelated paragraphs lines up their "a"s and "the"s into word salad).
function alike(a: string, b: string) {
  if (a === b) return 1;
  const wa = new Set(a.toLowerCase().match(/[\p{L}\p{N}_]+/gu)), wb = new Set(b.toLowerCase().match(/[\p{L}\p{N}_]+/gu));
  if (!wa.size || !wb.size) return 0;
  let both = 0;
  for (const w of wa) if (wb.has(w)) both++;
  return (2 * both) / (wa.size + wb.size);
}

export function textChanges(base: string, text: string): Region[] {
  if (base === text) return [];
  const al = lines(base), bl = lines(text);
  const ao = starts(al, 0), bo = starts(bl, 0);
  const raw: Hunk[] = []; // in characters
  const wordsOf = (a0: number, a1: number, b0: number, b1: number) => {
    const aw = words(base.slice(a0, a1)), bw = words(text.slice(b0, b1));
    const awo = starts(aw, a0), bwo = starts(bw, b0);
    for (const w of myers(aw, bw)) raw.push({ a0: awo[w.a0]!, a1: awo[w.a1]!, b0: bwo[w.b0]!, b1: bwo[w.b1]! });
  };
  // hunks only blank lines apart are one change to the paragraphs: Myers lines up the blank lines between rewritten
  // paragraphs, which would leave each paragraph to pair only with what sits in its own small hunk
  const hunks: Hunk[] = [];
  for (const h of myers(al, bl)) {
    const last = hunks[hunks.length - 1];
    if (last && al.slice(last.a1, h.a0).every((l) => !l.trim())) (last.a1 = h.a1), (last.b1 = h.b1);
    else hunks.push(h);
  }
  for (const h of hunks) {
    // each new line takes the most alike old line still ahead of it (40% of words in common at least): the old
    // lines skipped were removed, a new line with no match was added, a matched pair has its words diffed. Removed
    // lines go before the added ones between the same two pairs, as a diff reads (old, then new).
    let i = h.a0;
    let adds = -1; // the first new line with no match since the last pair
    const flush = (k: number, j: number) => {
      const b = bo[adds < 0 ? j : adds]!;
      if (k > i) raw.push({ a0: ao[i]!, a1: ao[k]!, b0: b, b1: b });
      if (adds >= 0) raw.push({ a0: ao[k]!, a1: ao[k]!, b0: b, b1: bo[j]! });
      adds = -1;
    };
    for (let j = h.b0; j < h.b1; j++) {
      let best = -1, score = 0.4;
      for (let k = i; k < h.a1; k++) {
        const s = alike(al[k]!, bl[j]!);
        if (s >= score) (best = k), (score = s);
        if (s === 1) break;
      }
      if (best < 0) {
        if (adds < 0) adds = j;
        continue;
      }
      flush(best, j);
      wordsOf(ao[best]!, ao[best + 1]!, bo[j]!, bo[j + 1]!);
      i = best + 1;
    }
    flush(h.a1, h.b1);
  }
  // hunks a few characters apart read as one edit
  const merged: Hunk[] = [];
  for (const h of raw) {
    const last = merged[merged.length - 1];
    // two edits read as one only when nothing but a space or a mark sits between them ("the cat" → "a dog"), never
    // across a line: merging edits a word apart cascaded through busy paragraphs into one struck-out block
    const gap = last ? text.slice(last.b1, h.b0) : "";
    const ends = last ? base.slice(last.a0, last.a1) + text.slice(last.b0, last.b1) : "";
    if (last && /^[^\p{L}\p{N}\n]{0,2}$/u.test(gap) && base.slice(last.a1, h.a0) === gap && !ends.endsWith("\n")) (last.a1 = h.a1), (last.b1 = h.b1);
    else merged.push({ ...h });
  }
  return merged.map((h) => ({ from: h.b0, to: h.b1, before: base.slice(h.a0, h.a1) }));
}
