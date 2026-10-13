// Obsidian-style live preview: the markdown string is never touched; decorations render it Notion-like.
// Syntax markers are hidden (Decoration.replace) except on lines the selection touches.
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import type { Extension, Range } from "@codemirror/state";
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
  ".cm-lp-bullet": { display: "inline-block", width: "1.1em", textAlign: "center" },
  ".cm-lp-task": { margin: "0 0.4em 0 0.1em", verticalAlign: "-2px", width: "16px", height: "16px", accentColor: "#2383e2", cursor: "pointer" },
  ".cm-lp-quote": { borderLeft: "3px solid #37352f", paddingLeft: "14px !important" },
  ".cm-lp-codeblock": { background: "#f7f6f3", fontFamily: mono, fontSize: "14px", padding: "0 16px !important" },
  ".cm-lp-fence": { color: "rgba(55,53,47,.4)", fontSize: "12px" },
  ".cm-lp-hr": { display: "inline-block", width: "100%", height: "1px", background: "rgba(55,53,47,.16)", verticalAlign: "middle" },
  ".cm-lp-img": { display: "block", maxWidth: "100%", margin: "4px 0", borderRadius: "3px" },
});

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-lp-bullet";
    s.textContent = "•";
    return s;
  }
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

class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean) { super(); }
  eq(o: TaskWidget) { return o.checked === this.checked; }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-lp-task";
    box.checked = this.checked;
    box.disabled = view.state.readOnly;
    box.addEventListener("mousedown", (e) => e.preventDefault()); // keep the cursor where it is
    box.addEventListener("click", (e) => {
      e.preventDefault();
      if (view.state.readOnly) return;
      const pos = view.posAtDOM(box) + 1; // the char inside "[ ]"
      const cur = view.state.doc.sliceString(pos, pos + 1);
      if (!/[ xX]/.test(cur)) return;
      view.dispatch({ changes: { from: pos, to: pos + 1, insert: cur === " " ? "x" : " " }, userEvent: "input" });
    });
    return box;
  }
  ignoreEvent() { return true; }
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
const bullet = Decoration.replace({ widget: new BulletWidget() });
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
          case "ListMark": {
            const item = n.parent;
            const listName = item?.parent?.name;
            if (listName === "OrderedList") out.push(muted.range(n.from, n.to));
            else if (item?.getChild("Task")) marker(n, true); // Notion: checkbox replaces the bullet
            else if (onActive(n.from)) out.push(muted.range(n.from, n.to));
            else out.push(bullet.range(n.from, n.to));
            return;
          }
          case "TaskMarker":
            if (onActive(n.from)) out.push(muted.range(n.from, n.to));
            else out.push(Decoration.replace({ widget: new TaskWidget(/x/i.test(doc.sliceString(n.from, n.to))) }).range(n.from, n.to));
            return;
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

export function editorExtensions(): Extension[] {
  return [
    history(),
    drawSelection(),
    dropCursor(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    markdown({ base: markdownLanguage }),
    EditorView.lineWrapping,
    theme,
    preview,
  ];
}
