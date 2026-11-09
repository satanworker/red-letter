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

export function textChanges(base: string, text: string): Region[] {
  if (base === text) return [];
  const al = lines(base), bl = lines(text);
  const ao = starts(al, 0), bo = starts(bl, 0);
  const raw: Hunk[] = []; // in characters
  for (const h of myers(al, bl)) {
    // words inside the changed lines
    const as = base.slice(ao[h.a0], ao[h.a1]), bs = text.slice(bo[h.b0], bo[h.b1]);
    const aw = words(as), bw = words(bs);
    const awo = starts(aw, ao[h.a0]!), bwo = starts(bw, bo[h.b0]!);
    for (const w of myers(aw, bw)) raw.push({ a0: awo[w.a0]!, a1: awo[w.a1]!, b0: bwo[w.b0]!, b1: bwo[w.b1]! });
  }
  // hunks a few characters apart read as one edit
  const merged: Hunk[] = [];
  for (const h of raw) {
    const last = merged[merged.length - 1];
    if (last && h.b0 - last.b1 < 12 && h.a0 - last.a1 < 12) (last.a1 = h.a1), (last.b1 = h.b1);
    else merged.push({ ...h });
  }
  return merged.map((h) => ({ from: h.b0, to: h.b1, before: base.slice(h.a0, h.a1) }));
}
