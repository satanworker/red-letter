import type { PrThread } from "../repo/pulls.ts";
import { parse, plain, sameProse, type Message, type Thread } from "./inline.ts";

// A review comment on the PR ends with a hidden marker (GitHub's page hides HTML comments) carrying what was
// commented: the quote and its offsets in the doc's text without comment markup (plain()). That's how the comment
// gets back its exact text here, where GitHub only keeps a line.
const MARKER = /\n*<!--rl (\{.*\})-->\s*$/s;
export type PrMark = { quote: string; from: number; to: number };
export const withPrMark = (body: string, m: PrMark) => `${body}\n\n<!--rl ${JSON.stringify(m)}-->`;
export function splitPrMark(body: string): { body: string; mark: PrMark | null } {
  const m = MARKER.exec(body);
  if (!m) return { body, mark: null };
  try {
    const mark = JSON.parse(m[1]!) as PrMark;
    return { body: body.slice(0, m.index), mark: typeof mark.quote === "string" ? mark : null };
  } catch {
    return { body, mark: null };
  }
}

// The occurrence of `q` in `s` nearest to `near`, or -1.
function nearest(s: string, q: string, near: number): number {
  const before = s.lastIndexOf(q, near), after = s.indexOf(q, near);
  if (before < 0) return after;
  if (after < 0) return before;
  return near - before <= after - near ? before : after;
}

// Messages per PrThread object (the store hands out new ones only on refresh): a card whose messages haven't
// changed keeps its objects while the doc is typed in.
const messagesOf = new WeakMap<PrThread, Message[]>();
function prMessages(t: PrThread): Message[] {
  let ms = messagesOf.get(t);
  if (!ms) messagesOf.set(t, (ms = t.comments.map((c, i) => ({ author: c.author, at: c.at, body: i ? c.body : splitPrMark(c.body).body }))));
  return ms;
}

// Threads in document order, with ranges in `text` (the open doc). docThreads: the doc's own (commentMarks.ts keeps
// them as the editor's text changes). prText: the comment PR's copy of the doc on a protected branch, whose threads
// are mapped onto the doc's text instead (by quote if the two differ in more than comments). prThreads: review
// threads on the branch's pull request, placed by their marker's quote (searched nearest to where it was), else by
// GitHub's line (the committed file is `text`, so its lines are the file's), else unplaced (outdated).
// ponytail: plain(text) is O(doc) per version tick once there's anything to map; keep offsets in the editor if typing
// on a commented PR branch gets slow.
export function selectThreads(docThreads: Thread[], text: string, prText: string | null, prThreads: PrThread[] = []): Thread[] {
  let threads = docThreads;
  if (prText !== null) {
    const doc = plain(text), pr = plain(prText);
    const same = sameProse(doc, pr);
    threads = parse(prText).threads.map((t) => {
      let range = t.range && same ? { from: doc.toText(pr.toPlain(t.range.from), 1), to: doc.toText(pr.toPlain(t.range.to), -1) } : null;
      const i = t.range && !same && t.quote ? doc.text.indexOf(t.quote) : -1;
      if (i >= 0) range = { from: doc.toText(i, 1), to: doc.toText(i + t.quote.length, -1) };
      return { ...t, range };
    });
  }
  if (prThreads.length) {
    const doc = plain(text);
    // start..end, 1-based inclusive lines of `text`, without the last line's newline
    const lineRange = (start: number, end: number) => {
      let from = 0;
      for (let i = 1; i < start; i++) {
        const nl = text.indexOf("\n", from);
        if (nl < 0) return null;
        from = nl + 1;
      }
      let to = from - 1;
      for (let i = start; i <= end; i++) {
        const nl = text.indexOf("\n", to + 1);
        if (nl < 0) return i === end ? { from, to: text.length } : null;
        to = nl;
      }
      return { from, to };
    };
    threads = threads.concat(
      prThreads.flatMap((t): Thread[] => {
        const first = t.comments[0];
        if (!first) return [];
        const mark = splitPrMark(first.body).mark;
        let range: Thread["range"] = null;
        const i = mark?.quote ? nearest(doc.text, mark.quote, mark.from) : -1;
        if (mark && i >= 0) range = { from: doc.toText(i, 1), to: doc.toText(i + mark.quote.length, -1) };
        else if (t.line !== null) range = lineRange(t.startLine ?? t.line, t.line);
        const quote = mark?.quote || (range ? text.slice(range.from, range.to) : "");
        return [{ id: t.id, range, quote, messages: prMessages(t), resolved: t.resolved, source: "pr", pr: { number: t.pr.number, url: t.pr.url, threadId: t.id, firstCommentId: first.id, outdated: t.outdated } }];
      }),
    );
  }
  return threads.toSorted((a, b) => (a.range?.from ?? Infinity) - (b.range?.from ?? Infinity));
}
