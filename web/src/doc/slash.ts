// "/" at the start of a line (indent allowed) opens a menu of markdown blocks; picking one replaces the "/word"
// with the block's markdown. CodeMirror's autocomplete, with only this source (lang-markdown's HTML-tag completion
// stays off).
import { autocompletion, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";

// `‸` marks where the cursor lands (end of the inserted text if absent)
const blocks: [label: string, detail: string, md: string][] = [
  ["Heading 1", "#", "# "],
  ["Heading 2", "##", "## "],
  ["Heading 3", "###", "### "],
  ["Bullet list", "-", "- "],
  ["Numbered list", "1.", "1. "],
  ["Task", "- [ ]", "- [ ] "],
  ["Quote", ">", "> "],
  ["Code block", "```", "```\n‸\n```"],
  ["Mermaid diagram", "```mermaid", "```mermaid\nflowchart LR\n  A[‸Start] --> B[End]\n```"],
  ["Table", "| |", "| Column | Column |\n| --- | --- |\n| | |\n"], // the blank line after it keeps the next line out of the table
  ["Divider", "---", "---\n"],
];

const options: Completion[] = blocks.map(([label, detail, md], i) => ({
  label,
  detail,
  boost: -i, // listed in this order, not alphabetically
  // `from` is just after the "/": the menu filters on the word typed after it, and the "/" goes too
  apply: (view, _c, from, to) => {
    const at = md.indexOf("‸");
    const insert = md.replace("‸", "");
    const cursor = from - 1 + (at < 0 ? insert.length : at);
    view.dispatch({ changes: { from: from - 1, to, insert }, selection: { anchor: cursor }, scrollIntoView: true, userEvent: "input.complete" });
  },
}));

function slash(ctx: CompletionContext) {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const m = /^\s*\/(\w*)$/.exec(ctx.state.sliceDoc(line.from, ctx.pos));
  return m ? { from: ctx.pos - m[1]!.length, options, validFor: /^\w*$/ } : null;
}

export const slashCommands = [
  autocompletion({ override: [slash], icons: false }),
  EditorView.theme({
    ".cm-tooltip.cm-tooltip-autocomplete": { border: "none", borderRadius: "8px", backgroundColor: "var(--card)", boxShadow: "var(--pop)", padding: "4px 0" },
    ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--sans)", fontSize: "12px", maxHeight: "18em" },
    ".cm-tooltip-autocomplete > ul > li": { display: "flex", justifyContent: "space-between", gap: "16px", padding: "6px 12px", color: "var(--fg)" },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--hover)", color: "var(--fg)" },
    ".cm-completionDetail": { fontStyle: "normal", color: "var(--muted)" },
    ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "500" },
  }),
];
