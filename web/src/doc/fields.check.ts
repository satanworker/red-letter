// bun src/doc/fields.check.ts: the state fields that follow edits instead of rescanning the doc (block widgets,
// blocks.ts; comment markup, commentMarks.ts; headings, headings.ts), taken through random edits and the parser
// catching up, hold exactly what a fresh build of the same text holds.
import { markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState, type StateField } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { commentMarks, commentSpans, commentThreads } from "./commentMarks.ts";
import { headingField } from "./headings.ts";
import { imageField } from "./images.ts";
import { mermaidField } from "./mermaid.ts";
import { tableField } from "./tables.ts";

const blocks = { tableField, imageField, mermaidField } as unknown as Record<string, StateField<{ deco: DecorationSet }>>;
const extensions = [markdownLanguage.extension, tableField, imageField, mermaidField, commentMarks, headingField];
const parsed = (s: EditorState) => (ensureSyntaxTree(s, s.doc.length, 5000), s.update({}).state); // as the background parse does
const widgets = (s: EditorState, f: StateField<{ deco: DecorationSet }>, upto: number) => {
  const out: string[] = [];
  s.field(f).deco.between(0, upto, (from, to, d) => void out.push(`${from}-${to} ${JSON.stringify(d.spec.widget)}`));
  return out.join("\n");
};
const comments = (s: EditorState) => JSON.stringify([commentSpans(s), commentThreads(s)]);
const tops = (s: EditorState, upto: number) => {
  const out: string[] = [];
  const c = syntaxTree(s).cursor();
  if (c.firstChild()) do if (c.from < upto) out.push(`${c.name} ${c.from}-${c.to}`); while (c.nextSibling());
  return out.join();
};
const headings = (s: EditorState) => JSON.stringify(s.field(headingField).found);

const doc = Array.from({ length: 30 }, (_, i) =>
  [`## H${i} <!--rl:c${i}-->noted<!--/rl:c${i}-->`, "", `Text ![a](images/f${i}.svg) <!--rl:d${i}-->more<!--/rl:d${i}--> text.`, "", `- item ![b](images/g${i}.svg)`, "  | x | y |", "  | - | - |", "  | 1 | 2 |", "", `| a${i} | b |`, "| --- | --- |", "| 1 | 2 |", "", "```mermaid", `flowchart LR`, `  A${i} --> B`, "```", "", `> ![c](images/q${i}.svg)`, "", "```ts", `# not a heading ${i}`, "```", ""].join("\n"),
)
  .concat(Array.from({ length: 30 }, (_, i) => [`<!--rl:c${i}${i % 3 ? "" : " resolved"}`, `@a 2026-11-01: one ${i}`, "  # continued", `@b: two`, "-->"].join("\n")))
  .concat(Array.from({ length: 30 }, (_, i) => [`<!--rl:d${i}`, `@a: d ${i}`, "-->"].join("\n")))
  .join("\n");
const SNIPS = ["\n", "\n\n", "```", "~~~\n", "```mermaid\nflowchart LR\n  A --> B\n```\n", "| a | b |\n| --- | --- |\n| 1 | 2 |\n", "![x](images/y.svg)", "x", " word ", "- ", "> ", "# ", "## Title ", "|", "\n---\n", "", "<!--", "-->", "<!--rl:c3-->", "<!--/rl:c3-->", "<!--rl:new1-->w<!--/rl:new1-->", "\n<!--rl:new1\n@z: hi\n-->\n", "rl:", "-"];
let seed = 3;
const rnd = (n: number) => ((seed = (seed * 48271) % 2147483647), seed % n);
let state = EditorState.create({ doc, extensions });
for (let i = 0; i < 1500; i++) {
  const len = state.doc.length;
  const from = rnd(len + 1), del = rnd(4) || len < 2000 ? 0 : Math.min(rnd(200), len - from);
  const insert = SNIPS[rnd(SNIPS.length)]!;
  state = state.update({ changes: { from, to: from + del, insert } }).state;
  if (i % 7 === 0) state = parsed(state);
  const fresh = parsed(EditorState.create({ doc: state.doc, extensions }));
  const edit = `edit ${i} (at ${from}, -${del}, +${JSON.stringify(insert)})`;
  if (comments(state) !== comments(fresh)) throw new Error(`comment markup after ${edit} differs from a fresh parse`);
  if (headings(state) !== headings(fresh)) throw new Error(`headings after ${edit} differ from a fresh scan`);
  const upto = syntaxTree(state).length; // past the parsed text, a block field keeps what it had, moved along
  // lezer's incremental parse of mangled markdown can differ from a fresh one (a table read as a paragraph): the field
  // follows its own tree, so compare only where the two trees agree
  if (syntaxTree(fresh).length < upto || tops(state, upto) !== tops(fresh, upto)) continue;
  for (const [name, f] of Object.entries(blocks)) if (widgets(state, f, upto) !== widgets(fresh, f, upto)) throw new Error(`${name} after ${edit} differs from a fresh build`);
}
console.log("incremental fields: ok");
