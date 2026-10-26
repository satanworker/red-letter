// Obsidian-style live preview: the markdown string is never touched; decorations render it Notion-like.
// Syntax markers always show, muted, so moving the cursor never reflows the text. Heading marks hang in the left
// margin. Images and mermaid diagrams render under their source (images.ts, mermaid.ts); tables are the one
// exception, a widget in place of the source (tables.ts).
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import type { Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, drawSelection, dropCursor, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { codeHighlight } from "./highlight.ts";
import { imageField } from "./images.ts";
import { mermaidField, mermaidTheme } from "./mermaid.ts";
import { cellComments, tableField, tableTheme } from "./tables.ts";

const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const theme = EditorView.theme({
  "&": { color: "var(--fg)", backgroundColor: "var(--bg)", fontSize: "12px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--sans)", lineHeight: "1.25" },
  // the text fills the doc column, 80px down (Figma 8:202); the left side leaves room for "###### " hanging there
  ".cm-content": { padding: "80px 30px 30vh 56px", caretColor: "var(--blue)" },
  ".cm-line": { padding: "0 2px" },
  // CodeMirror wraps with break-spaces, so a space at the end of a line takes room and pushes the last word down.
  // pre-wrap lets it hang past the edge, as Figma does (Figma 8:198 fits 61 characters in 440px).
  ".cm-lineWrapping": { whiteSpace: "pre-wrap" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--blue)", borderLeftWidth: "2px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--sel) !important",
  },
  // Design: H1 28px / H2 20px Medium; 28px between blocks = one blank line (15px) + 13px padding.
  ".cm-lp-h1": { fontSize: "28px", fontWeight: "500", lineHeight: "1.25", padding: "13px 2px" },
  ".cm-lp-h2": { fontSize: "20px", fontWeight: "500", lineHeight: "1.25", padding: "13px 2px" },
  ".cm-lp-h3": { fontSize: "16px", fontWeight: "500", lineHeight: "1.25", padding: "13px 2px" },
  ".cm-lp-h4, .cm-lp-h5, .cm-lp-h6": { fontWeight: "500", padding: "13px 2px" },
  // "## " in body size, hung left of the heading text (margin set per mark: its length in ch)
  ".cm-lp-hmark": { fontSize: "12px", fontWeight: "400", color: "var(--faint)" },
  ".cm-content > .cm-line:first-child": { paddingTop: "0" },
  ".cm-lp-mark": { color: "var(--mark)" },
  ".cm-lp-strong": { fontWeight: "600" },
  ".cm-lp-em": { fontStyle: "italic" },
  ".cm-lp-strike": { textDecoration: "line-through" },
  ".cm-lp-code": {
    fontFamily: mono, fontSize: "85%", color: "var(--code)", background: "var(--code-bg)",
    borderRadius: "4px", padding: "0.2em 0.4em",
  },
  ".cm-lp-link": { color: "inherit", borderBottom: "1px solid var(--faint)", cursor: "pointer" },
  // List items keep their raw marker ("- ", "1. ", "- [ ] "). The font is monospace, so the indent is the marker's
  // length in ch: wrapped lines hang under the item's text, as do continuation lines indented to it.
  ".cm-lp-li": { paddingLeft: "calc(var(--lp-in) + 2px) !important", textIndent: "calc(-1 * var(--lp-in))" },
  ".cm-lp-taskmark": { cursor: "pointer" },
  ".cm-lp-quote": { borderLeft: "3px solid var(--fg)", paddingLeft: "14px !important" },
  ".cm-lp-codeblock": { background: "var(--bg2)", fontFamily: mono, fontSize: "12px", padding: "0 16px !important" },
  ".cm-lp-fence": { color: "var(--faint)", fontSize: "11px" },
  // Figma 82:749: the image fits the column (block widgets skip the line's 2px padding), 28px under its markdown line
  // and 28px above the next block (13 + a blank line)
  ".cm-lp-img": { display: "block", maxWidth: "calc(100% - 4px)", margin: "28px 2px 13px" },
});

const muted = Decoration.mark({ class: "cm-lp-mark" });
const marks: Record<string, Decoration> = {
  StrongEmphasis: Decoration.mark({ class: "cm-lp-strong" }),
  Emphasis: Decoration.mark({ class: "cm-lp-em" }),
  Strikethrough: Decoration.mark({ class: "cm-lp-strike" }),
  InlineCode: Decoration.mark({ class: "cm-lp-code" }),
};
const link = Decoration.mark({ class: "cm-lp-link" });
const line = (cls: string) => Decoration.line({ class: cls });
const taskMark = Decoration.mark({ class: "cm-lp-mark cm-lp-taskmark", attributes: { title: "Click to check or uncheck" } });

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const out: Range<Decoration>[] = [];
  const lines = (from: number, to: number, vfrom: number, vto: number, deco: (l: number, first: number, last: number) => Decoration) => {
    const first = doc.lineAt(from).number, last = doc.lineAt(to).number;
    for (let l = doc.lineAt(Math.max(from, vfrom)).number; l <= doc.lineAt(Math.min(to, vto)).number; l++)
      out.push(deco(l, first, last).range(doc.line(l).from));
  };
  const listed = new Set<number>(); // line starts already indented (items can span visible ranges)
  // One item: its first line and the later lines of its own text (soft-wrapped in the source, or Shift-Enter) hang
  // at the width of the marker. Nested lists are their own items.
  const listItem = (item: SyntaxNode, vfrom: number, vto: number) => {
    const mark = item.getChild("ListMark");
    if (!mark) return;
    const task = item.getChild("Task")?.getChild("TaskMarker");
    out.push(muted.range(mark.from, mark.to));
    if (task) out.push(taskMark.range(task.from, task.to));
    const first = doc.lineAt(mark.from);
    let start = (task ?? mark).to;
    while (start < first.to && doc.sliceString(start, start + 1) === " ") start++;
    const indent = Decoration.line({ class: "cm-lp-li", attributes: { style: `--lp-in:${start - first.from}ch` } });
    const indentLine = (from: number) => {
      if (from < vfrom || from > vto || listed.has(from)) return;
      listed.add(from);
      out.push(indent.range(from));
    };
    indentLine(first.from);
    for (let c = item.firstChild; c; c = c.nextSibling) {
      if (c.name !== "Paragraph" && c.name !== "Task") continue;
      for (let l = doc.lineAt(c.from).number; l <= doc.lineAt(c.to).number; l++) indentLine(doc.line(l).from);
    }
  };

  for (const { from: vfrom, to: vto } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from: vfrom,
      to: vto,
      enter: (ref) => {
        const n = ref.node;
        const name = n.name;
        const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(name);
        if (heading) {
          out.push(line(`cm-lp-h${heading[1]}`).range(doc.lineAt(n.from).from));
          return;
        }
        switch (name) {
          case "HeaderMark": {
            // the leading "## " (with its space) hangs left of the text; a closing "##" and Setext underlines stay put
            if (n.parent?.name.startsWith("Setext") || n.prevSibling) out.push(muted.range(n.from, n.to));
            else {
              const end = doc.sliceString(n.to, n.to + 1) === " " ? n.to + 1 : n.to;
              out.push(Decoration.mark({ class: "cm-lp-hmark", attributes: { style: `margin-left:-${end - n.from}ch` } }).range(n.from, end));
            }
            return;
          }
          case "StrongEmphasis": case "Emphasis": case "Strikethrough": case "InlineCode":
            out.push(marks[name]!.range(n.from, n.to));
            return;
          case "EmphasisMark": case "StrikethroughMark":
            out.push(muted.range(n.from, n.to));
            return;
          case "CodeMark":
            if (n.parent?.name === "InlineCode") out.push(muted.range(n.from, n.to));
            return;
          case "Link": {
            const marksIn = n.getChildren("LinkMark");
            const open = marksIn[0], close = marksIn[1];
            if (!open || !close || doc.sliceString(open.from, open.to) !== "[") return false; // autolink etc.
            if (close.from > open.to) out.push(link.range(open.to, close.from));
            out.push(muted.range(open.from, open.to), muted.range(close.from, n.to));
            return false;
          }
          case "URL":
            if (n.parent?.name !== "Image") out.push(link.range(n.from, n.to));
            return;
          case "Image": // imageField renders the picture under the line
            out.push(muted.range(n.from, n.to));
            return false;
          case "ListItem":
            listItem(n, vfrom, vto);
            return;
          case "Table":
            return false; // tableField renders it
          case "Blockquote":
            lines(n.from, n.to, vfrom, vto, () => line("cm-lp-quote"));
            return;
          case "QuoteMark":
          case "HorizontalRule":
            out.push(muted.range(n.from, n.to));
            return;
          case "FencedCode": {
            const closed = n.lastChild?.name === "CodeMark" && doc.lineAt(n.lastChild.from).number > doc.lineAt(n.from).number;
            lines(n.from, n.to, vfrom, vto, (l, first, last) =>
              line(l === first || (closed && l === last) ? "cm-lp-codeblock cm-lp-fence" : "cm-lp-codeblock"));
            return false;
          }
        }
      },
    });
  }
  return Decoration.set(out, true);
}

const preview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = build(view); }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state))
        this.decorations = build(u.view);
    }
  },
  {
    decorations: (p) => p.decorations,
    eventHandlers: {
      // a task's "[ ]" toggles on click; Cmd/Ctrl-click opens the link under the pointer
      mousedown(e, view) {
        const task = (e.target as HTMLElement).closest?.(".cm-lp-taskmark");
        if (task && e.button === 0 && !e.metaKey && !e.ctrlKey) {
          const at = view.posAtDOM(task) + 1;
          const ch = view.state.doc.sliceString(at, at + 1);
          if (view.state.readOnly || !/[ xX]/.test(ch)) return false;
          e.preventDefault(); // keep the cursor where it is
          view.dispatch({ changes: { from: at, to: at + 1, insert: ch === " " ? "x" : " " }, userEvent: "input" });
          return true;
        }
        if (!(e.metaKey || e.ctrlKey) || e.button !== 0) return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos == null) return false;
        for (let n: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, 1); n; n = n.parent) {
          const url = n.name === "URL" ? n : n.name === "Link" ? n.getChild("URL") : null;
          if (!url) continue;
          const href = view.state.doc.sliceString(url.from, url.to);
          if (!/^(https?:|mailto:)/i.test(href)) return false;
          window.open(href, "_blank", "noopener");
          e.preventDefault();
          return true;
        }
        return false;
      },
    },
  },
);

// Shift-Enter in a list item: a new line inside the same item, indented to its text, instead of a new bullet.
// (GitHub renders such a line as part of the same paragraph.) Elsewhere: a plain line break.
function lineInItem(view: EditorView): boolean {
  const { state } = view;
  let insert = "\n";
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(state.selection.main.head, -1); n; n = n.parent) {
    const mark = n.name === "ListItem" ? n.getChild("ListMark") : null;
    if (!mark) continue;
    const line = state.doc.lineAt(mark.from);
    let start = mark.to;
    while (start < line.to && state.doc.sliceString(start, start + 1) === " ") start++;
    insert += " ".repeat(start - line.from);
    break;
  }
  view.dispatch({ ...state.replaceSelection(insert), scrollIntoView: true, userEvent: "input" });
  return true;
}

export function editorExtensions(): Extension[] {
  return [
    history(),
    drawSelection(),
    dropCursor(),
    keymap.of([{ key: "Shift-Enter", run: lineInItem }, ...defaultKeymap, ...historyKeymap, indentWithTab]),
    markdown({ base: markdownLanguage }),
    EditorView.lineWrapping,
    theme,
    preview,
    tableField,
    tableTheme,
    cellComments,
    mermaidField,
    imageField,
    mermaidTheme,
    codeHighlight,
  ];
}
