// bun src/comments/inline.check.ts — the comment format's round trip; throws on the first broken case.
import { addThread, apply, hidden, parse, plain, remove, reply, sameProse, setResolved } from "./inline.ts";

const eq = (got: unknown, want: unknown, what: string) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
};

const base = "# T\n\nThe hub relays live sync and nothing else.\n";
const at = base.indexOf("relays");
let t = apply(base, addThread(base, at, at + 16, "c1", { author: "a", at: "2026-11-01T10:12Z", body: "two\nlines -->" }));
t = apply(t, reply(t, "c1", { author: "agent", at: "", body: "ok" }));
const w = t.indexOf("nothing");
t = apply(t, addThread(t, w, w + 7, "c2", { author: "b", at: "2026-11-01", body: "hm" }));
const [c1, c2] = parse(t).threads;
eq([c1!.quote, c2!.quote], ["relays live sync", "nothing"], "quotes");
eq(c1!.messages, [{ author: "a", at: "2026-11-01T10:12Z", body: "two\nlines -->" }, { author: "agent", at: "", body: "ok" }], "messages");
eq(sameProse(plain(base), plain(t)), true, "markup-only difference");
const b = plain(base), p = plain(t), live = base.indexOf("live");
eq(t.slice(p.toText(b.toPlain(live), 1), p.toText(b.toPlain(live + 4), -1)), "live", "position mapping");
eq([c1!.resolved, c2!.resolved], [false, false], "comments without the flag are open");
const done = apply(t, setResolved(t, "c1", true));
const r1 = parse(done).threads[0]!;
eq([r1.resolved, r1.quote, r1.messages.length], [true, "relays live sync", 2], "resolving keeps the markers and messages");
eq(done.includes("<!--rl:c1 resolved\n@a "), true, "the flag sits on the block's first line");
eq(setResolved(done, "c1", true), [], "resolving twice is a no-op");
eq(sameProse(plain(base), plain(done)), true, "the flag is markup");
eq(apply(done, setResolved(done, "c1", false)), t, "reopening restores the text");
const one = apply(done, remove(done, "c2"));
eq(apply(one, remove(one, "c1")), base, "deleting restores the doc (resolved or not)");
eq(hidden("```\n<!--rl:x-->a<!--/rl:x-->\n<!--rl:x\n@a: b\n-->\n```\n"), [], "fenced code is not a comment");
console.log("inline comments: ok");
