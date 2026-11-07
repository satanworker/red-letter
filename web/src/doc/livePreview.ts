// Obsidian-style live preview: the markdown string is never touched; decorations render it Notion-like.
// Editing mode: syntax markers always show, muted, so moving the cursor never reflows the text; heading marks hang
// in the left margin. Reading mode (readingMode, read-only): the markers are hidden and lists, tasks and rules are
// drawn (Figma 140:2782 "Basic Typography"). Images and mermaid diagrams render under their source (images.ts,
// mermaid.ts); tables are the one exception, a widget in place of the source (tables.ts).
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, Facet, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, drawSelection, dropCursor, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { codeHighlight } from "./highlight.ts";
import { imageField } from "./images.ts";
import { mermaidField, mermaidTheme } from "./mermaid.ts";
import { slashCommands } from "./slash.ts";
import { cellComments, tableField, tableTheme } from "./tables.ts";

const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export const readingMode = Facet.define<boolean, boolean>({ combine: (v) => v.some(Boolean) });

const theme = EditorView.theme({
  "&": { color: "var(--fg)", backgroundColor: "var(--bg)", fontSize: "12px" },
  "&.cm-focused": { outline: "none" },
  // Figma 140:2782 "Basic Text": 12px on 16px lines
  ".cm-scroller": { fontFamily: "var(--sans)", lineHeight: "16px" },
  // a centred 620px text column (30px padding each side), 80px down (Figma 142:2967); heading marks hang into the
  // side margin
  ".cm-content": { boxSizing: "border-box", maxWidth: "680px", margin: "0 auto", padding: "80px 30px 30vh", caretColor: "var(--blue)" },
  ".cm-line": { padding: "0 2px" },
  // CodeMirror wraps with break-spaces, so a space at the end of a line takes room and pushes the last word down.
  // pre-wrap lets it hang past the edge, as Figma does (Figma 8:198 fits 61 characters in 440px).
  ".cm-lineWrapping": { whiteSpace: "pre-wrap" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--blue)", borderLeftWidth: "2px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--sel) !important",
  },
  // Figma 140:2782: H1 24px / H2 20px / H3 16px Medium on 1.25 lines; 28px between blocks = one blank line (16px)
  // + 12px padding.
  ".cm-lp-h1": { fontSize: "24px", fontWeight: "500", lineHeight: "1.25", padding: "12px 2px" },
  ".cm-lp-h2": { fontSize: "20px", fontWeight: "500", lineHeight: "1.25", padding: "12px 2px" },
  ".cm-lp-h3": { fontSize: "16px", fontWeight: "500", lineHeight: "1.25", padding: "12px 2px" },
  ".cm-lp-h4, .cm-lp-h5, .cm-lp-h6": { fontWeight: "500", padding: "12px 2px" },
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
  // List items keep their raw marker ("- ", "1. ", "- [ ] "), in the text colour (Figma 140:2782 "Mark down"
  // columns). The font is monospace, so the indent is the marker's length in ch: wrapped lines hang under the item's
  // text, as do continuation lines indented to it.
  ".cm-lp-li": { paddingLeft: "calc(var(--lp-in) + 2px) !important", textIndent: "calc(-1 * var(--lp-in))" },
  // items of one list sit a blank line (16px) apart, so a wrapped item doesn't run into the next
  ".cm-lp-li-gap": { paddingTop: "16px !important" },
  ".cm-lp-taskmark": { cursor: "pointer" },
  // Figma 140:2943: a 2px Shadows bar, 12px gap, muted text, 4px above and below the quote
  ".cm-lp-quote": { borderLeft: "2px solid var(--muted)", paddingLeft: "12px !important", color: "var(--muted)" },
  ".cm-lp-quote-first": { paddingTop: "4px" },
  ".cm-lp-quote-last": { paddingBottom: "4px" },
  // Reading mode (Figma 140:2782): a 4px dot and the text 20px in; an 8px box and the text 16px in, filled and the
  // text struck through when checked; a rule 20px in from the column's edges, in a 20px line.
  "&.cm-reading .cm-cursorLayer": { display: "none" },
  ".cm-lp-bullet, .cm-lp-box": { display: "inline-block", verticalAlign: "top", textIndent: "0" },
  ".cm-lp-bullet": { width: "20px" },
  ".cm-lp-bullet::before": { content: '""', display: "block", width: "4px", height: "4px", marginTop: "6px", borderRadius: "50%", background: "var(--fg)" },
  ".cm-lp-box": { width: "16px" },
  ".cm-lp-box::before": {
    content: '""', display: "block", boxSizing: "border-box", width: "8px", height: "8px", marginTop: "4px",
    border: ".4px solid var(--fg)", borderRadius: "2px",
  },
  ".cm-lp-box-on::before": { background: "var(--fg)" },
  ".cm-lp-done": { textDecoration: "line-through" },
  ".cm-lp-hr": {
    display: "inline-block", verticalAlign: "top", width: "calc(100% - 36px)", height: "20px", margin: "0 18px",
    background: "linear-gradient(var(--fg), var(--fg)) center / 100% .8px no-repeat",
  },
  ".cm-lp-codeblock": { background: "var(--bg2)", fontFamily: mono, fontSize: "12px", padding: "0 16px !important" },
  ".cm-lp-fence": { color: "var(--faint)", fontSize: "11px" },
  // Figma 82:749: the image fits the column (block widgets skip the line's 2px padding), 28px under its markdown line
  // and 28px above the next block (12 + a blank line)
  // Padding, not margin: CodeMirror measures a block widget's box, and a margin it can't see shifts every click below.
  ".cm-lp-img": { display: "block", maxWidth: "calc(100% - 4px)", margin: "0 2px", padding: "28px 0 12px" },
});

const muted = Decoration.mark({ class: "cm-lp-mark" });
const hidden = Decoration.replace({});
class Glyph extends WidgetType {
  constructor(readonly cls: string) { super(); }
  eq(o: Glyph) { return o.cls === this.cls; }
  toDOM() {
    const el = document.createElement("span");
    el.className = this.cls;
    return el;
  }
}
const glyph = (cls: string) => Decoration.replace({ widget: new Glyph(cls) });
const bullet = glyph("cm-lp-bullet"), box = glyph("cm-lp-box"), boxOn = glyph("cm-lp-box cm-lp-box-on"), rule = glyph("cm-lp-hr");
const done = Decoration.mark({ class: "cm-lp-done" });
const marks: Record<string, Decoration> = {
  StrongEmphasis: Decoration.mark({ class: "cm-lp-strong" }),
  Emphasis: Decoration.mark({ class: "cm-lp-em" }),
  Strikethrough: Decoration.mark({ class: "cm-lp-strike" }),
  InlineCode: Decoration.mark({ class: "cm-lp-code" }),
};
const link = Decoration.mark({ class: "cm-lp-link" });
const line = (cls: string) => Decoration.line({ class: cls });
const taskMark = Decoration.mark({ class: "cm-lp-taskmark", attributes: { title: "Click to check or uncheck" } });

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const reading = state.facet(readingMode);
  const out: Range<Decoration>[] = [];
  // a syntax marker: muted while editing, gone while reading
  const marker = (from: number, to: number) => to > from && out.push((reading ? hidden : muted).range(from, to));
  const lines = (from: number, to: number, vfrom: number, vto: number, deco: (l: number, first: number, last: number) => Decoration) => {
    const first = doc.lineAt(from).number, last = doc.lineAt(to).number;
    for (let l = doc.lineAt(Math.max(from, vfrom)).number; l <= doc.lineAt(Math.min(to, vto)).number; l++)
      out.push(deco(l, first, last).range(doc.line(l).from));
  };
  const listed = new Set<number>(); // line starts already indented (items can span visible ranges)
  // One item: its first line and the later lines of its own text (soft-wrapped in the source, or Shift-Enter) hang
  // at the width of the marker. Nested lists are their own items. Reading: a bullet's "- " becomes a dot and a
  // task's "- [ ] " a box; numbers stay.
  const listItem = (item: SyntaxNode, vfrom: number, vto: number) => {
    const mark = item.getChild("ListMark");
    if (!mark) return;
    const taskNode = item.getChild("Task");
    const task = taskNode?.getChild("TaskMarker");
    const first = doc.lineAt(mark.from);
    let start = (task ?? mark).to;
    while (start < first.to && doc.sliceString(start, start + 1) === " ") start++;
    let width = `${start - first.from}ch`;
    if (!reading) {
      if (task) out.push(taskMark.range(task.from, task.to));
    } else if (task) {
      const on = /x/i.test(doc.sliceString(task.from, task.to));
      out.push((on ? boxOn : box).range(mark.from, start));
      if (on && taskNode!.to > start) out.push(done.range(start, taskNode!.to));
      width = `calc(${mark.from - first.from}ch + 16px)`;
    } else if (item.parent?.name === "BulletList") {
      out.push(bullet.range(mark.from, start));
      width = `calc(${mark.from - first.from}ch + 20px)`;
    }
    const style = `--lp-in:${width}`;
    const indent = Decoration.line({ class: "cm-lp-li", attributes: { style } });
    const indentLine = (from: number, deco = indent) => {
      if (from < vfrom || from > vto || listed.has(from)) return;
      listed.add(from);
      out.push(deco.range(from));
    };
    indentLine(first.from, item.prevSibling ? Decoration.line({ class: "cm-lp-li cm-lp-li-gap", attributes: { style } }) : indent);
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
            const end = doc.sliceString(n.to, n.to + 1) === " " ? n.to + 1 : n.to;
            if (n.parent?.name.startsWith("Setext") || n.prevSibling) marker(n.from, n.to);
            else if (reading) out.push(hidden.range(n.from, end));
            else out.push(Decoration.mark({ class: "cm-lp-hmark", attributes: { style: `margin-left:-${end - n.from}ch` } }).range(n.from, end));
            return;
          }
          case "StrongEmphasis": case "Emphasis": case "Strikethrough": case "InlineCode":
            out.push(marks[name]!.range(n.from, n.to));
            return;
          case "EmphasisMark": case "StrikethroughMark":
            marker(n.from, n.to);
            return;
          case "CodeMark":
            if (n.parent?.name === "InlineCode") marker(n.from, n.to);
            return;
          case "Link": {
            const marksIn = n.getChildren("LinkMark");
            const open = marksIn[0], close = marksIn[1];
            if (!open || !close || doc.sliceString(open.from, open.to) !== "[") return false; // autolink etc.
            if (close.from > open.to) out.push(link.range(open.to, close.from));
            marker(open.from, open.to);
            marker(close.from, n.to);
            return false;
          }
          case "URL":
            if (n.parent?.name !== "Image") out.push(link.range(n.from, n.to));
            return;
          case "Image": // imageField renders the picture under the line
            marker(n.from, n.to);
            return false;
          case "ListItem":
            listItem(n, vfrom, vto);
            return;
          case "Table":
            return false; // tableField renders it
          case "Blockquote":
            lines(n.from, n.to, vfrom, vto, (l, first, last) =>
              line(`cm-lp-quote${l === first ? " cm-lp-quote-first" : ""}${l === last ? " cm-lp-quote-last" : ""}`));
            return;
          case "QuoteMark":
            marker(n.from, reading && doc.sliceString(n.to, n.to + 1) === " " ? n.to + 1 : n.to);
            return;
          case "HorizontalRule":
            out.push((reading ? rule : muted).range(n.from, n.to));
            return;
          case "FencedCode": {
            const closed = n.lastChild?.name === "CodeMark" && doc.lineAt(n.lastChild.from).number > doc.lineAt(n.from).number;
            lines(n.from, n.to, vfrom, vto, (l, first, last) =>
              line(l === first || (closed && l === last) ? "cm-lp-codeblock cm-lp-fence" : "cm-lp-codeblock"));
            if (reading) for (let c = n.firstChild; c; c = c.nextSibling) if (c.name === "CodeMark" || c.name === "CodeInfo") marker(c.from, c.to);
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
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state) || u.startState.facet(readingMode) !== u.state.facet(readingMode))
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

// Mod-b / Mod-i: wrap each selection in ** / *, or unwrap it when that mark sits just outside or just inside it.
// A run of stars holds italic when its length is odd (`*`, `***`) and bold when it's 2 or more.
const emphasis = (n: 1 | 2) => (view: EditorView): boolean => {
  const { state } = view;
  if (state.readOnly) return false;
  const doc = state.doc;
  const has = (run: number) => (n === 1 ? run % 2 === 1 : run >= 2);
  // stars in a row from `at`, going right (1) or left (-1), not past `stop`
  const stars = (at: number, dir: 1 | -1, stop: number) => {
    let i = 0;
    for (let c = dir > 0 ? at : at - 1; (dir > 0 ? c < stop : c >= stop) && doc.sliceString(c, c + 1) === "*"; c += dir) i++;
    return i;
  };
  const m = "*".repeat(n);
  const tx = state.changeByRange((r) => {
    if (has(stars(r.from, -1, 0)) && has(stars(r.to, 1, doc.length)))
      return { changes: [{ from: r.from - n, to: r.from }, { from: r.to, to: r.to + n }], range: EditorSelection.range(r.from - n, r.to - n) };
    if (r.to - r.from > 2 * n && has(stars(r.from, 1, r.to)) && has(stars(r.to, -1, r.from)))
      return { changes: [{ from: r.from, to: r.from + n }, { from: r.to - n, to: r.to }], range: EditorSelection.range(r.from, r.to - 2 * n) };
    return { changes: [{ from: r.from, insert: m }, { from: r.to, insert: m }], range: EditorSelection.range(r.from + n, r.to + n) };
  });
  view.dispatch({ ...tx, scrollIntoView: true, userEvent: "input" });
  return true;
};

export function editorExtensions(): Extension[] {
  return [
    history(),
    drawSelection(),
    dropCursor(),
    keymap.of([{ key: "Shift-Enter", run: lineInItem }, { key: "Mod-b", run: emphasis(2) }, { key: "Mod-i", run: emphasis(1) }, ...defaultKeymap, ...historyKeymap, indentWithTab]),
    slashCommands,
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
