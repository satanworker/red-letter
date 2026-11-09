// bun src/comments/prThreads.check.ts — PR review threads placed in the doc: by the marker's quote (nearest to where
// it was, even after the text moved), else by GitHub's lines, else unplaced (outdated). Throws on the first broken case.
import type { PrThread } from "../repo/pulls.ts";
import { selectThreads, splitPrMark, withPrMark } from "./commentsSelectors.ts";
import { addThread, apply } from "./inline.ts";

const eq = (got: unknown, want: unknown, what: string) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
};
const thread = (id: string, body: string, at: Partial<PrThread> = {}): PrThread => ({
  id,
  pr: { number: 7, url: "https://github.com/o/r/pull/7", head: "o/demo-review", base: "main", title: "Review of demo.md" },
  path: "demo.md",
  line: null,
  startLine: null,
  resolved: false,
  outdated: false,
  comments: [{ id: 1, nodeId: "n1", author: "a", at: "2026-11-09T10:00:00Z", body }],
  ...at,
});

const base = "# T\n\nThe hub relays live sync and nothing else.\nA second line, with sync in it.\n";
const q = "sync", at = base.indexOf("relays live sync") + 12; // the first "sync"
const marked = withPrMark("Which sync?", { quote: q, from: at, to: at + q.length });
eq(splitPrMark(marked), { body: "Which sync?", mark: { quote: q, from: at, to: at + q.length } }, "marker round trip");
eq(splitPrMark("plain body"), { body: "plain body", mark: null }, "no marker");

// placed by the quote: the first "sync", not the one on the next line
let [t] = selectThreads([], base, null, [thread("T1", marked)]);
eq([t!.source, t!.quote, t!.messages[0]!.body, base.slice(t!.range!.from, t!.range!.to)], ["pr", q, "Which sync?", q], "quote placed and marker stripped");
eq(t!.pr, { number: 7, url: "https://github.com/o/r/pull/7", threadId: "T1", firstCommentId: 1, outdated: false }, "pr ref");

// the text above it grew: the nearest "sync" to the old offset is still the right one
const moved = "# Title, longer now\n\nAn inserted paragraph.\n" + base.slice(4);
[t] = selectThreads([], moved, null, [thread("T1", marked)]);
eq(moved.slice(t!.range!.from, t!.range!.to), q, "moved quote found");
eq(t!.range!.from, moved.indexOf("relays live sync") + 12, "…the first occurrence, nearest to where it was");

// the quote sits inside in-file comment markup: offsets are in the text without markup, mapped back
const withFile = apply(base, addThread(base, base.indexOf("relays"), base.indexOf("relays") + 16, "c1", { author: "b", at: "", body: "hm" }));
[t] = selectThreads([], withFile, null, [thread("T1", marked)]);
eq(withFile.slice(t!.range!.from, t!.range!.to), q, "quote found through comment markup");

// no quote found, GitHub's line known: the whole line (lines are the committed file's, markup and all)
[t] = selectThreads([], base, null, [thread("T2", withPrMark("gone", { quote: "vanished text", from: 0, to: 13 }), { line: 4 })]);
eq(base.slice(t!.range!.from, t!.range!.to), "A second line, with sync in it.", "GitHub's line");
[t] = selectThreads([], base, null, [thread("T3", "no marker at all", { startLine: 3, line: 4 })]);
eq(base.slice(t!.range!.from, t!.range!.to), "The hub relays live sync and nothing else.\nA second line, with sync in it.", "a line range");
eq(t!.quote, "The hub relays live sync and nothing else.\nA second line, with sync in it.", "quote from the lines when there's no marker");
[t] = selectThreads([], base, null, [thread("T4", "past the end", { line: 40 })]);
eq(t!.range, null, "a line the file no longer has");

// outdated on GitHub and the quote gone: unplaced, flagged
[t] = selectThreads([], base, null, [thread("T5", withPrMark("old", { quote: "vanished text", from: 0, to: 13 }), { outdated: true, resolved: true })]);
eq([t!.range, t!.pr!.outdated, t!.resolved, t!.quote], [null, true, true, "vanished text"], "outdated thread keeps its quote, has no range");

// merged with the doc's own threads, in document order; messages keep identity across calls for the same PrThread
const file = selectThreads([{ id: "c1", range: { from: 60, to: 64 }, quote: "else", messages: [], resolved: false, source: "file" }], base, null, [thread("T1", marked)]);
eq(file.map((x) => x.id), ["T1", "c1"], "document order across sources");
const same = thread("T1", marked);
eq(selectThreads([], base, null, [same])[0]!.messages === selectThreads([], moved, null, [same])[0]!.messages, true, "messages kept per PrThread");
console.log("pr threads: ok");
