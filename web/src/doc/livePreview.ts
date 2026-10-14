// Obsidian-style live preview: the markdown string is never touched; decorations render it Notion-like.
// Syntax markers are hidden (Decoration.replace) except on lines the selection touches.
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  drawSelection,
  dropCursor,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const theme = EditorView.theme({
  "&": { color: "#37352f", backgroundColor: "#fff", fontSize: "16px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: 'ui-sans-serif, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif', lineHeight: "1.7" },
  ".cm-content": { maxWidth: "720px", margin: "0 auto", padding: "48px 32px 30vh", caretColor: "#2383e2" },
  ".cm-line": { padding: "0 2px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#2383e2", borderLeftWidth: "2px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "rgba(35,131,226,.18) !important",
  },
  ".cm-lp-h1": { fontSize: "1.875em", fontWeight: "700", lineHeight: "1.3", paddingTop: "0.9em" },
  ".cm-lp-h2": { fontSize: "1.5em", fontWeight: "600", lineHeight: "1.3", paddingTop: "0.7em" },
  ".cm-lp-h3": { fontSize: "1.25em", fontWeight: "600", lineHeight: "1.3", paddingTop: "0.5em" },
  ".cm-lp-h4, .cm-lp-h5, .cm-lp-h6": { fontWeight: "600", paddingTop: "0.3em" },
  ".cm-lp-mark": { color: "rgba(55,53,47,.35)" },
  ".cm-lp-strong": { fontWeight: "600" },
  ".cm-lp-em": { fontStyle: "italic" },
  ".cm-lp-strike": { textDecoration: "line-through" },
  ".cm-lp-code": {
    fontFamily: mono, fontSize: "85%", color: "#eb5757", background: "rgba(135,131,120,.15)",
    borderRadius: "4px", padding: "0.2em 0.4em",
  },
  ".cm-lp-link": { color: "inherit", borderBottom: "1px solid rgba(55,53,47,.4)", cursor: "pointer" },
  // List items: the marker (bullet, number, checkbox, or the raw "- " on the cursor line) sits in a box as wide as
  // the item's indent, inside the line's padding, so wrapped and continuation lines align with the item's text.
  ".cm-lp-li": { paddingLeft: "calc(var(--lp-in) + 2px) !important", textIndent: "calc(-1 * var(--lp-in))" },
  ".cm-lp-prefix": { display: "inline-block", width: "var(--lp-in)", textIndent: "0", textAlign: "right", whiteSpace: "pre" },
  ".cm-lp-bullet": { display: "inline-block", width: "1.1em", textAlign: "center" },
  ".cm-lp-num": { color: "rgba(55,53,47,.65)", paddingRight: "0.35em" },
  ".cm-lp-tablewrap": { overflowX: "auto", margin: "6px 0", cursor: "text" },
  ".cm-lp-table": { borderCollapse: "collapse", fontSize: "14px", lineHeight: "1.5", minWidth: "60%" },
  ".cm-lp-table th, .cm-lp-table td": { border: "1px solid rgba(55,53,47,.16)", padding: "6px 10px", verticalAlign: "top" },
  ".cm-lp-table th": { background: "#f7f6f3", fontWeight: "600" },
  ".cm-lp-table code": { fontFamily: mono, fontSize: "85%", color: "#eb5757", background: "rgba(135,131,120,.15)", borderRadius: "4px", padding: "0.1em 0.3em" },
  ".cm-lp-task": { margin: "0 0.35em 0 0", verticalAlign: "-2px", width: "16px", height: "16px", accentColor: "#2383e2", cursor: "pointer" },
  ".cm-lp-quote": { borderLeft: "3px solid #37352f", paddingLeft: "14px !important" },
  ".cm-lp-codeblock": { background: "#f7f6f3", fontFamily: mono, fontSize: "14px", padding: "0 16px !important" },
  ".cm-lp-fence": { color: "rgba(55,53,47,.4)", fontSize: "12px" },
  ".cm-lp-hr": { display: "inline-block", width: "100%", height: "1px", background: "rgba(55,53,47,.16)", verticalAlign: "middle" },
  ".cm-lp-img": { display: "block", maxWidth: "100%", margin: "4px 0", borderRadius: "3px" },
});

type Prefix = { kind: "bullet" | "number" | "task" | "none"; text: string; checked: boolean };

class PrefixWidget extends WidgetType {
  constructor(readonly p: Prefix) { super(); }
  eq(o: PrefixWidget) { return o.p.kind === this.p.kind && o.p.text === this.p.text && o.p.checked === this.p.checked; }
  toDOM(view: EditorView) {
    const box = document.createElement("span");
    box.className = "cm-lp-prefix";
    if (this.p.kind === "task") box.append(taskBox(view, box, this.p.checked));
    else if (this.p.kind !== "none") {
      const s = document.createElement("span");
      s.className = this.p.kind === "bullet" ? "cm-lp-bullet" : "cm-lp-num";
      s.textContent = this.p.text;
      box.append(s);
    }
    return box;
  }
  ignoreEvent() { return this.p.kind === "task"; }
}

class HrWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-lp-hr";
    return s;
  }
}

class ImageWidget extends WidgetType {
  constructor(readonly url: string, readonly alt: string) { super(); }
  eq(o: ImageWidget) { return o.url === this.url && o.alt === this.alt; }
  toDOM() {
    const img = document.createElement("img");
    img.className = "cm-lp-img";
    img.src = this.url;
    img.alt = this.alt;
    return img;
  }
}

// A checkbox that toggles the "[ ]" of the list item on its line.
function taskBox(view: EditorView, owner: HTMLElement, checked: boolean) {
  const box = document.createElement("input");
  box.type = "checkbox";
  box.className = "cm-lp-task";
  box.checked = checked;
  box.disabled = view.state.readOnly;
  box.addEventListener("mousedown", (e) => e.preventDefault()); // keep the cursor where it is
  box.addEventListener("click", (e) => {
    e.preventDefault();
    if (view.state.readOnly) return;
    const line = view.state.doc.lineAt(view.posAtDOM(owner));
    const m = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]/.exec(line.text);
    if (!m) return;
    const pos = line.from + m[0].length - 2;
    view.dispatch({ changes: { from: pos, to: pos + 1, insert: m[1] === " " ? "x" : " " }, userEvent: "input" });
  });
  return box;
}

const hide = Decoration.replace({});
const muted = Decoration.mark({ class: "cm-lp-mark" });
const marks: Record<string, Decoration> = {
  StrongEmphasis: Decoration.mark({ class: "cm-lp-strong" }),
  Emphasis: Decoration.mark({ class: "cm-lp-em" }),
  Strikethrough: Decoration.mark({ class: "cm-lp-strike" }),
  InlineCode: Decoration.mark({ class: "cm-lp-code" }),
};
const link = Decoration.mark({ class: "cm-lp-link" });
const line = (cls: string) => Decoration.line({ class: cls });
const hr = Decoration.replace({ widget: new HrWidget() });

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const active = new Set<number>();
  for (const r of state.selection.ranges)
    for (let l = doc.lineAt(r.from).number; l <= doc.lineAt(r.to).number; l++) active.add(l);
  const onActive = (pos: number) => active.has(doc.lineAt(pos).number);
  const out: Range<Decoration>[] = [];
  const marker = (n: SyntaxNode, withSpace = false) => {
    if (n.from === n.to) return;
    const end = withSpace && doc.sliceString(n.to, n.to + 1) === " " ? n.to + 1 : n.to; // "# ", "> ", "- "
    if (onActive(n.from)) out.push(muted.range(n.from, n.to));
    else out.push(hide.range(n.from, end));
  };
  const lines = (from: number, to: number, vfrom: number, vto: number, deco: (l: number, first: number, last: number) => Decoration) => {
    const first = doc.lineAt(from).number, last = doc.lineAt(to).number;
    for (let l = doc.lineAt(Math.max(from, vfrom)).number; l <= doc.lineAt(Math.min(to, vto)).number; l++)
      out.push(deco(l, first, last).range(doc.line(l).from));
  };
  const listed = new Set<number>(); // line starts already given a list prefix (items can span visible ranges)
  const prefix = (from: number, to: number, style: string, p: Prefix) => {
    if (listed.has(from)) return;
    listed.add(from);
    out.push(Decoration.line({ attributes: { class: "cm-lp-li", style } }).range(from));
    if (to > from && onActive(from)) out.push(Decoration.mark({ class: "cm-lp-prefix cm-lp-mark" }).range(from, to));
    else if (to > from) out.push(Decoration.replace({ widget: new PrefixWidget(p) }).range(from, to));
    else out.push(Decoration.widget({ widget: new PrefixWidget({ kind: "none", text: "", checked: false }), side: -1 }).range(from));
  };
  // One item: its first line gets the marker; later lines of its own text (soft-wrapped in the source, or
  // Shift-Enter) get an empty box of the same width. Nested lists are their own items.
  const listItem = (item: SyntaxNode, vfrom: number, vto: number) => {
    const mark = item.getChild("ListMark");
    if (!mark) return;
    let depth = 0;
    for (let p = item.parent; p; p = p.parent) if (p.name === "BulletList" || p.name === "OrderedList") depth++;
    const task = item.getChild("Task")?.getChild("TaskMarker");
    const ordered = item.parent?.name === "OrderedList";
    const style = `--lp-in:${(depth - 1) * 1.5 + (task ? 2 : ordered ? 1.6 : 1.1)}em`;
    const first = doc.lineAt(mark.from);
    let start = (task ?? mark).to;
    while (start < first.to && doc.sliceString(start, start + 1) === " ") start++;
    if (first.from >= vfrom && first.from <= vto) {
      const text = doc.sliceString(mark.from, mark.to);
      const p: Prefix = task
        ? { kind: "task", text: "", checked: /x/i.test(doc.sliceString(task.from, task.to)) }
        : ordered
          ? { kind: "number", text, checked: false }
          : { kind: "bullet", text: ["•", "◦", "▪"][(depth - 1) % 3]!, checked: false };
      prefix(first.from, start, style, p);
    }
    for (let c = item.firstChild; c; c = c.nextSibling) {
      if (c.name !== "Paragraph" && c.name !== "Task") continue;
      for (let l = doc.lineAt(c.from).number; l <= doc.lineAt(c.to).number; l++) {
        const ln = doc.line(l);
        if (l === first.number || ln.from < vfrom || ln.from > vto) continue;
        const ws = /^\s*/.exec(ln.text)![0].length;
        prefix(ln.from, ln.from + ws, style, { kind: "none", text: "", checked: false });
      }
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
          case "HeaderMark":
            if (n.parent?.name.startsWith("Setext")) out.push(muted.range(n.from, n.to));
            else marker(n, true);
            return;
          case "StrongEmphasis": case "Emphasis": case "Strikethrough": case "InlineCode":
            out.push(marks[name]!.range(n.from, n.to));
            return;
          case "EmphasisMark": case "StrikethroughMark":
            marker(n);
            return;
          case "CodeMark":
            if (n.parent?.name === "InlineCode") marker(n);
            return;
          case "Link": {
            const marksIn = n.getChildren("LinkMark");
            const open = marksIn[0], close = marksIn[1];
            if (!open || !close || doc.sliceString(open.from, open.to) !== "[") return false; // autolink etc.
            if (close.from > open.to) out.push(link.range(open.to, close.from));
            if (onActive(n.from)) out.push(muted.range(open.from, open.to), muted.range(close.from, n.to));
            else out.push(hide.range(open.from, open.to), hide.range(close.from, n.to));
            return false;
          }
          case "URL":
            if (n.parent?.name !== "Image") out.push(link.range(n.from, n.to));
            return;
          case "Image": {
            const url = n.getChild("URL");
            const src = url ? doc.sliceString(url.from, url.to) : "";
            if (!onActive(n.from) && src.startsWith("https://")) {
              const m = n.getChildren("LinkMark");
              const alt = m.length > 1 ? doc.sliceString(m[0]!.to, m[1]!.from) : "";
              out.push(Decoration.replace({ widget: new ImageWidget(src, alt) }).range(n.from, n.to));
            } else out.push(muted.range(n.from, n.to));
            return false;
          }
          case "ListItem":
            listItem(n, vfrom, vto);
            return;
          case "Table":
            return false; // tableField renders it
          case "Blockquote":
            lines(n.from, n.to, vfrom, vto, () => line("cm-lp-quote"));
            return;
          case "QuoteMark":
            marker(n, true);
            return;
          case "FencedCode": {
            const closed = n.lastChild?.name === "CodeMark" && doc.lineAt(n.lastChild.from).number > doc.lineAt(n.from).number;
            lines(n.from, n.to, vfrom, vto, (l, first, last) =>
              line(l === first || (closed && l === last) ? "cm-lp-codeblock cm-lp-fence" : "cm-lp-codeblock"));
            return false;
          }
          case "HorizontalRule":
            if (onActive(n.from)) out.push(muted.range(n.from, n.to));
            else out.push(hr.range(n.from, n.to));
            return;
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
      if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state))
        this.decorations = build(u.view);
    }
  },
  {
    decorations: (p) => p.decorations,
    eventHandlers: {
      // Cmd/Ctrl-click opens the link under the pointer
      mousedown(e, view) {
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

// ---- tables: rendered as an HTML table unless the selection is in it, then shown as raw markdown ----
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
// Cell text -> HTML: code spans, bold, italic, link text. Link targets are dropped; nothing from the doc is
// inserted unescaped.
const cellHtml = (s: string) =>
  s
    .split(/(`[^`]+`)/)
    .map((part, i) =>
      i % 2
        ? `<code>${esc(part.slice(1, -1))}</code>`
        : esc(part)
            .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
            .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
            .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"),
    )
    .join("");
// GFM: unescaped pipes split cells, even inside code spans.
const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replaceAll("\\|", "|"));

class TableWidget extends WidgetType {
  constructor(readonly src: string) { super(); }
  eq(o: TableWidget) { return o.src === this.src; }
  toDOM() {
    const [head = "", delim = "", ...body] = this.src.split("\n");
    const align = cells(delim).map((d) => (d.endsWith(":") ? (d.startsWith(":") ? "center" : "right") : "left"));
    const row = (r: string, tag: "th" | "td") =>
      `<tr>${cells(r).map((c, i) => `<${tag} style="text-align:${align[i] ?? "left"}">${cellHtml(c)}</${tag}>`).join("")}</tr>`;
    const wrap = document.createElement("div");
    wrap.className = "cm-lp-tablewrap";
    wrap.innerHTML = `<table class="cm-lp-table"><thead>${row(head, "th")}</thead><tbody>${body.map((r) => row(r, "td")).join("")}</tbody></table>`;
    return wrap;
  }
  ignoreEvent() { return false; } // a click puts the cursor at the table, which shows it raw for editing
}

function tables(state: EditorState): DecorationSet {
  const doc = state.doc;
  const out: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (n) => {
      if (n.name === "Paragraph" || n.name === "FencedCode" || n.name.includes("Heading")) return false; // no tables inside
      if (n.name !== "Table") return;
      const first = doc.lineAt(n.from), last = doc.lineAt(n.to);
      const touched = state.selection.ranges.some((r) => r.to >= first.from && r.from <= last.to);
      if (!touched) out.push(Decoration.replace({ widget: new TableWidget(doc.sliceString(first.from, last.to)), block: true }).range(first.from, last.to));
      return false;
    },
  });
  return Decoration.set(out, true);
}

// Block widgets can't come from a view plugin, so tables live in a state field.
// ponytail: rebuilt on every selection change by walking the block tree; fine for docs of a few thousand lines.
const tableField = StateField.define<DecorationSet>({
  create: tables,
  update: (deco, tr) => (tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState) ? tables(tr.state) : deco),
  provide: (f) => EditorView.decorations.from(f),
});

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
  ];
}
