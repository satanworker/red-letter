import { parse, plain, sameProse, type Thread } from "./inline.ts";

// Threads in document order, with ranges in `text` (the open doc). prText: the comment PR's copy of the doc on a
// protected branch, whose threads are mapped onto the doc's text (by quote if the two differ in more than comments).
export function selectThreads(text: string, prText: string | null): Thread[] {
  let threads = parse(prText ?? text).threads;
  if (prText !== null) {
    const doc = plain(text), pr = plain(prText);
    const same = sameProse(doc, pr);
    threads = threads.map((t) => {
      let range = t.range && same ? { from: doc.toText(pr.toPlain(t.range.from), 1), to: doc.toText(pr.toPlain(t.range.to), -1) } : null;
      const i = t.range && !same && t.quote ? doc.text.indexOf(t.quote) : -1;
      if (i >= 0) range = { from: doc.toText(i, 1), to: doc.toText(i + t.quote.length, -1) };
      return { ...t, range };
    });
  }
  return threads.sort((a, b) => (a.range?.from ?? Infinity) - (b.range?.from ?? Infinity));
}
