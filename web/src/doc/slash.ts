// "/" at the start of a line (indent allowed) opens a menu of markdown blocks; picking one replaces the "/query" with
// the block's markdown. CodeMirror's autocomplete, with only this source (lang-markdown's HTML-tag completion stays
// off). Figma 183:953 "Dropdown menu /": the dropdown card, a block's name on the left and its markdown on the right in
// Shadows grey, fading out at the foot while there's more. Its first line is the search: what's typed after the "/"
// (spaces too: "/code b"), matched against the names, their markdown and a few aliases ("h1", "todo", "hr").
import { autocompletion, type Completion, type CompletionContext, type CompletionSection } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";

// `‸` marks where the cursor lands (end of the inserted text if absent)
const blocks: [label: string, detail: string, md: string, aliases: string][] = [
  ["Heading 1", "#", "# ", "h1 title"],
  ["Heading 2", "##", "## ", "h2 subtitle"],
  ["Heading 3", "###", "### ", "h3"],
  ["Bullet list", "-", "- ", "ul bullets unordered"],
  ["Numbered list", "1.", "1. ", "ol numbers ordered numbering"],
  ["Task", "-[ ]", "- [ ] ", "todo checkbox check checklist"],
  ["Quote", ">", "> ", "blockquote citation"],
  ["Code block", "```", "```\n‸\n```", "pre snippet"],
  ["Mermaid diagram", "```mermaid", "```mermaid\nflowchart LR\n  A[‸Start] --> B[End]\n```", "chart flowchart graph"],
  ["Table", "| |", "| Column | Column |\n| --- | --- |\n| | |\n", "grid columns rows"], // the blank line after it keeps the next line out of the table
  ["Divider", "---", "---\n", "hr rule line separator"],
];

const apply = (md: string) => (view: EditorView, _c: Completion, from: number, to: number) => {
  // `from` is just after the "/": the "/" goes too
  const at = md.indexOf("‸");
  const insert = md.replace("‸", "");
  const cursor = from - 1 + (at < 0 ? insert.length : at);
  view.dispatch({ changes: { from: from - 1, to, insert }, selection: { anchor: cursor }, scrollIntoView: true, userEvent: "input.complete" });
};

// How well `q` names a block: the name's start, a word's start, an alias, the markdown itself, anywhere in the name; null: not at all
function rank(q: string, label: string, detail: string, aliases: string): number | null {
  if (!q) return 0;
  const l = label.toLowerCase();
  if (l.startsWith(q)) return 0;
  if (l.split(" ").some((w) => w.startsWith(q))) return 1;
  if (aliases.split(" ").some((a) => a.startsWith(q))) return 2;
  if (detail === q || detail.replace(/\s/g, "") === q.replace(/\s/g, "")) return 2;
  return l.includes(q) ? 3 : null;
}

// The menu's first line: a search field's look, showing what's typed (no separate box: the typing stays in the text)
function searchLine(query: string): CompletionSection {
  return {
    name: query,
    header: () => {
      const el = document.createElement("div");
      el.className = "cm-slash-search";
      el.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5"/></svg>`;
      const text = el.appendChild(document.createElement("span"));
      text.textContent = query || "Search blocks";
      if (!query) text.className = "cm-slash-placeholder";
      return el;
    },
  };
}

function slash(ctx: CompletionContext) {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const m = /^\s*\/([\w ]*)$/.exec(ctx.state.sliceDoc(line.from, ctx.pos));
  if (!m || m[1]!.startsWith(" ")) return null;
  const query = m[1]!.trim().toLowerCase();
  const section = searchLine(m[1]!.trimEnd());
  const options = blocks
    .map(([label, detail, md, aliases], i) => ({ i, r: rank(query, label, detail, aliases), o: { label, detail, section, apply: apply(md) } as Completion }))
    .filter((x) => x.r !== null)
    .sort((a, b) => a.r! - b.r! || a.i - b.i)
    .map((x, i, all) => ({ ...x.o, boost: all.length - i })); // in this order, not CodeMirror's
  // no validFor: asked again on every keystroke, so the search line follows the typing; filter: off, the ranking is ours
  return options.length ? { from: ctx.pos - m[1]!.length, options, filter: false } : null;
}

export const slashCommands = [
  autocompletion({ override: [slash], icons: false }),
  // `.cm-tooltip.cm-tooltip-autocomplete`: as specific as CodeMirror's own rules, which otherwise win
  EditorView.theme({
    ".cm-tooltip.cm-tooltip-autocomplete": {
      border: "none", borderRadius: "12px", backgroundColor: "var(--card)", minWidth: "237px", padding: "0 14px",
      boxShadow: "0 4px 17.8px rgba(0,0,0,.1), var(--shadow)",
    },
    // 24px in at the top (under the search line, which stays put); the foot fades the list out while it scrolls on
    // (its last 24px are empty, so a list that fits shows whole)
    ".cm-tooltip.cm-tooltip-autocomplete > ul": {
      fontFamily: "var(--sans)", fontSize: "12px", maxHeight: "260px", padding: "0 0 24px",
      maskImage: "linear-gradient(to bottom, #000 calc(100% - 32px), transparent)",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > .cm-slash-search": {
      position: "sticky", top: "0", zIndex: "1", display: "flex", alignItems: "center", gap: "8px", margin: "0 -14px 8px",
      padding: "20px 20px 8px", lineHeight: "16px", color: "var(--fg)", backgroundColor: "var(--card)", borderBottom: ".5px solid var(--line)",
    },
    ".cm-slash-search svg": { color: "var(--muted)", flexShrink: "0" },
    ".cm-slash-placeholder": { color: "var(--muted)" },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
      display: "flex", justifyContent: "space-between", gap: "16px", padding: "4px 6px", lineHeight: "16px", color: "var(--fg)", borderRadius: "4px",
    },
    // Figma 184:1116: the row under the keys or the pointer is outlined, as a hovered row
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": { background: "transparent", color: "var(--fg)", boxShadow: "inset 0 0 0 .5px var(--line), var(--shadow)" },
    ".cm-completionDetail": { fontStyle: "normal", color: "var(--muted)" },
    ".cm-completionMatchedText": { textDecoration: "none" },
  }),
];
