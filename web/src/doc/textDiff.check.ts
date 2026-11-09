// bun src/doc/textDiff.check.ts — review highlights: applying every region's `before` back over the text gives the
// base again, the regions are in order and don't overlap, and an 8k-char post diffs in milliseconds.
import { textChanges } from "./textDiff.ts";

const undo = (text: string, rs: { from: number; to: number; before: string }[]) => {
  let out = text;
  for (const r of [...rs].reverse()) out = out.slice(0, r.from) + r.before + out.slice(r.to);
  return out;
};
const ok = (cond: unknown, what: string) => {
  if (!cond) throw new Error(what);
};
const cases: [string, string][] = [
  ["", ""],
  ["", "new doc\n"],
  ["old doc\n", ""],
  ["The cat sat on the mat.\n", "The dog sat on the mat.\n"],
  ["a\nb\nc\n", "a\nc\n"],
  ["one two three four five six seven\n", "one 2 three four five six 7\n"],
  ["# Title\n\nPara one.\n\nPara two.\n", "# Title\n\nPara one, edited.\n\nNew para.\n\nPara two.\n"],
];
for (const [a, b] of cases) {
  const rs = textChanges(a, b);
  ok(undo(b, rs) === a, `round trip: ${JSON.stringify([a, b])} → ${JSON.stringify(rs)}`);
  for (let i = 1; i < rs.length; i++) ok(rs[i]!.from >= rs[i - 1]!.to, "ordered, no overlap");
}
ok(textChanges("The cat sat.", "The dog sat.").length === 1, "one word, one region");
// a removed paragraph doesn't pull the rewritten one after it into one struck-out block, and edits a word apart stay apart
{
  const a = "Here is what a day looks like for us now.\n\nAt nine, an agent picks up a ticket and writes a plan for it.\n";
  const b = "**9:00.** An agent picks up a ticket and writes a plan.\n";
  const rs = textChanges(a, b);
  ok(undo(b, rs) === a, "removed paragraph round trip");
  ok(!rs.some((r) => r.before.includes("Here") && r.before.includes("agent")), `removed paragraph kept apart: ${JSON.stringify(rs)}`);
  ok(rs.some((r) => r.before === "for it" || r.before === " for it"), `the rewrite is diffed by word: ${JSON.stringify(rs)}`);
  ok(textChanges("That turned out to be exactly right, and now there are two.", "That is exactly right and Red Letter has two.").length >= 3, "a word apart stays apart");
}
// random edits
let seed = 1;
const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
const base = Array.from({ length: 120 }, (_, i) => `Line ${i} has some words in it, and more words after the comma.\n`).join("");
for (let run = 0; run < 50; run++) {
  let t = base;
  for (let e = 0; e < 15; e++) {
    const at = rnd(t.length), del = rnd(20);
    t = t.slice(0, at) + ["x", " new words ", "\n", ""][rnd(4)] + t.slice(at + del);
  }
  ok(undo(t, textChanges(base, t)) === base, `random run ${run}`);
}
const big = base.repeat(1), edited = big.replace(/Line 3/g, "Row 3").replace("more words", "fewer words");
const t0 = performance.now();
for (let i = 0; i < 20; i++) textChanges(big, edited + "x".repeat(i));
const ms = (performance.now() - t0) / 20;
ok(ms < 20, `fast: ${ms.toFixed(1)} ms a diff`);
console.log(`text diff: ok (${ms.toFixed(2)} ms a diff on ${big.length} chars)`);
