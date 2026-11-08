// The doc's `#` headings and `[text](url)` links (for its outline), kept by the editor: scanning every line on each
// keystroke cost time in proportion to the doc. A change rescans only the lines it touched, unless one of them is (or
// was) a code fence or the first or last line of a comment thread block, which can change what every later line is:
// then the doc is scanned again. Lines in code fences and in thread blocks hold neither; comment markers leave a
// heading's or link's text. A link's text spanning two lines isn't found.
import { StateField, type Text } from "@codemirror/state";
import type { Span } from "../comments/inline.ts";
import { commentSpans } from "./commentMarks.ts";

export type Found = { level: number; text: string; at: number }; // at: where the heading's line starts
export type Link = { text: string; url: string; from: number; to: number }; // from/to: the whole `[text](url)`
type Value = { found: Found[]; links: Link[]; fences: number[] }; // fences: starts of the fence lines that count, in order

const FENCE = /^ {0,3}(```|~~~)/;
const ATX = /^ {0,3}(#{1,6}) +(.*?)(?: +#+)? *$/;
const MARKER = /<!--\/?rl:[a-z0-9]+-->/g;
const unmarked = (text: string) => (text.includes("<!--") ? text.replace(MARKER, "") : text);
// not an image (`![`); an optional "title" after the url
const LINK = /(?<!!)\[([^\]]*)\]\(([^()\s]+)(?:\s+"[^"]*")?\)/g;
// comment markers and code spans blanked out in place, so a link's index is its column
const blanked = (text: string) => text.replace(/<!--\/?rl:[a-z0-9]+-->|`[^`]*`/g, (m) => " ".repeat(m.length));
// a line that can change whether later lines are fenced or in a thread block
const structural = (text: string) => FENCE.test(unmarked(text)) || /^<!--rl:|^-->/.test(text);

// Lines `first`..`last` (numbers) with `fenced` at the start; `blocks`: comment thread blocks, sorted.
function scan(doc: Text, blocks: Span[], first: number, last: number, fenced: boolean, out: Value) {
  let b = 0;
  let at = doc.line(first).from;
  const lines = doc.iterLines(first, last + 1);
  while (!lines.next().done) {
    const text = lines.value;
    while (b < blocks.length && blocks[b]!.to <= at) b++;
    if (!(b < blocks.length && blocks[b]!.from <= at)) {
      const t = unmarked(text);
      if (FENCE.test(t)) {
        fenced = !fenced;
        out.fences.push(at);
      } else if (!fenced) {
        const h = ATX.exec(t);
        const words = h?.[2]!.replace(/[*_`]/g, "").trim();
        if (h && words) out.found.push({ level: h[1]!.length, text: words, at });
        if (text.includes("](")) {
          for (const m of blanked(text).matchAll(LINK)) {
            const url = m[2]!;
            const from = at + m.index;
            // the words from the line itself (code spans were blanked only to match), markers and emphasis out
            const words = unmarked(text.slice(m.index + 1, m.index + 1 + m[1]!.length)).replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
            out.links.push({ text: words || url, url, from, to: from + m[0].length });
          }
        }
      }
    }
    at += text.length + 1;
  }
}

function all(doc: Text, blocks: Span[]): Value {
  const v: Value = { found: [], links: [], fences: [] };
  scan(doc, blocks, 1, doc.lines, false, v);
  return v;
}

// index of the first entry at or after `pos` in a sorted list of positions
function firstFrom(xs: number[], pos: number): number {
  let lo = 0, hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! < pos) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export const headingField = StateField.define<Value>({
  create: (state) => all(state.doc, commentSpans(state).blocks),
  update(v, tr) {
    if (!tr.docChanged) return v;
    const blocks = commentSpans(tr.state).blocks;
    const old = tr.startState.doc, doc = tr.state.doc;
    // the touched lines, as [first, last] line numbers in the new doc; any fence or markup on them, before or after
    const touched: [number, number][] = [];
    let local = true;
    tr.changes.iterChanges((fromA, toA, fromB, toB) => {
      for (let l = old.lineAt(fromA).number, end = old.lineAt(toA).number; local && l <= end; l++) local = !structural(old.line(l).text);
      const first = doc.lineAt(fromB).number, last = doc.lineAt(toB).number;
      for (let l = first; local && l <= last; l++) local = !structural(doc.line(l).text);
      const prev = touched.at(-1);
      if (prev && first <= prev[1]) prev[1] = Math.max(prev[1], last); // changes come in order: merge ones sharing a line
      else touched.push([first, last]);
    });
    if (!local) return all(doc, blocks);
    // no fence moved but by the change: keep what's off the touched lines (moved along), rescan those
    const map = (at: number) => tr.changes.mapPos(at);
    const fences = v.fences.map(map);
    const next: Value = { found: [], links: [], fences };
    let i = 0, j = 0;
    const kept = v.found.map((h) => ({ ...h, at: map(h.at) }));
    const keptLinks = v.links.map((l) => ({ ...l, from: map(l.from), to: map(l.to) }));
    for (const [first, last] of touched) {
      const from = doc.line(first).from, to = doc.line(last).to;
      while (i < kept.length && kept[i]!.at < from) next.found.push(kept[i++]!);
      while (i < kept.length && kept[i]!.at <= to) i++; // a heading on a touched line: rescanned
      while (j < keptLinks.length && keptLinks[j]!.from < from) next.links.push(keptLinks[j++]!);
      while (j < keptLinks.length && keptLinks[j]!.from <= to) j++;
      scan(doc, blocks, first, last, firstFrom(fences, from) % 2 === 1, { found: next.found, links: next.links, fences: [] });
    }
    while (i < kept.length) next.found.push(kept[i++]!);
    while (j < keptLinks.length) next.links.push(keptLinks[j++]!);
    return next;
  },
});
