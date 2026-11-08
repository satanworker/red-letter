// Obsidian-style live preview: the markdown string is never touched; decorations render it Notion-like.
// Typography: Figma 140:2782 "Typography Guideline" (pages: 148:3509 markdown/editing, 150:3757 reading).
// Editing mode: syntax markers always show, so moving the cursor never reflows the text. They take their content's
// style (`**` bold, backticks inside the grey highlight, a link's brackets blue); heading marks hang in the left
// margin in Dark Grey, a link's (url) is Shadows grey. Reading mode (readingMode, read-only): the markers are hidden
// and lists and tasks are drawn. Rules are drawn in both. Images and mermaid diagrams render under their source
// (images.ts, mermaid.ts); tables are the one exception, a widget in place of the source (tables.ts).
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdownKeymap, markdownLanguage, pasteURLAsLink } from "@codemirror/lang-markdown";
import { LanguageSupport, syntaxTree } from "@codemirror/language";
import { EditorSelection, Facet, Prec, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, drawSelection, dropCursor, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { codeHighlight } from "./highlight.ts";
import { imageField } from "./images.ts";
import { mermaidField, mermaidTheme } from "./mermaid.ts";
import { slashCommands } from "./slash.ts";
import { cellComments, tableField, tableTheme } from "./tables.ts";

export const readingMode = Facet.define<boolean, boolean>({ combine: (v) => v.some(Boolean) });

const theme = EditorView.theme({
  "&": { color: "var(--fg)", backgroundColor: "var(--bg)", fontSize: "12px" },
  "&.cm-focused": { outline: "none" },
  // Figma 140:2782 "Basic Text": 12px on 16px lines
  // Not a scroll container (CodeMirror's default is overflow-x: auto; lines wrap, so it never needed to scroll): one
  // would capture the tables' scroll timelines (tableTheme), which must see the doc's scroller. min-width 0 lets the
  // content shrink to a column narrower than 684px; it kept 684px and the old scroller scrolled it sideways.
  ".cm-scroller": { fontFamily: "var(--sans)", lineHeight: "16px", overflowX: "visible" },
  ".cm-scroller > .cm-content": { minWidth: "0" },
  // a centred 620px text column (30px padding each side, plus the lines' 2px for the caret), 80px down (Figma
  // 142:2967); heading marks hang into the side margin
  ".cm-content": { boxSizing: "border-box", maxWidth: "684px", margin: "0 auto", padding: "80px 30px 30vh", caretColor: "var(--blue)" },
  ".cm-line": { padding: "0 2px" },
  // CodeMirror wraps with break-spaces, so a space at the end of a line takes room and pushes the last word down.
  // pre-wrap lets it hang past the edge, as Figma does (Figma 8:198 fits 61 characters in 440px).
  ".cm-lineWrapping": { whiteSpace: "pre-wrap" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--blue)", borderLeftWidth: "2px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--sel) !important",
  },
  // Figma 140:2782: H1 24px / H2 20px / H3 16px Medium on 1.25 lines. Figma 148:3509 / 150:3757 keep 28px between
  // blocks: a blank line next to a heading is 16px and the heading adds 12px of padding; any other blank line that
  // follows a block is 28px itself (cm-lp-gap).
  ".cm-lp-h1": { position: "relative", fontSize: "24px", fontWeight: "500", lineHeight: "1.25", padding: "12px 2px" },
  ".cm-lp-h2": { position: "relative", fontSize: "20px", fontWeight: "500", lineHeight: "1.25", padding: "12px 2px" },
  ".cm-lp-h3": { position: "relative", fontSize: "16px", fontWeight: "500", lineHeight: "1.25", padding: "12px 2px" },
  ".cm-lp-h4, .cm-lp-h5, .cm-lp-h6": { position: "relative", fontWeight: "500", padding: "12px 2px" },
  ".cm-lp-gap": { paddingTop: "12px" },
  // "## " at the heading's size in Dark Grey, hung in the margin 12px left of the text (10px + the line's 2px), beside
  // the heading's last line as Figma 148:3509 draws it; its space takes no room. One line: it has no width to wrap in.
  ".cm-lp-hmark": { position: "absolute", right: "calc(100% + 10px)", bottom: "12px", whiteSpace: "pre", wordSpacing: "-1ch", color: "var(--mark)" },
  ".cm-lp-hmark-empty": { position: "static", wordSpacing: "calc(12px - 1ch)" },
  ".cm-content > .cm-line:first-child": { paddingTop: "0" },
  ".cm-lp-mark": { color: "var(--mark)" },
  ".cm-lp-strong": { fontWeight: "600" },
  ".cm-lp-em": { fontStyle: "italic" },
  ".cm-lp-strike": { textDecoration: "line-through" },
  // Figma "Highlight": Middle Grey behind the word (and its backticks), 4px corners, the text's own font and colour
  ".cm-lp-code": { background: "var(--code-bg)", borderRadius: "4px", padding: "0 2px" },
  // Figma "Links": the name blue (its brackets too while editing), underlined while reading; "(url)" Shadows grey,
  // the url underlined
  ".cm-lp-link": { color: "var(--link)", cursor: "pointer" },
  ".cm-lp-url": { color: "var(--muted)" },
  ".cm-lp-u": { textDecoration: "underline", textDecorationThickness: "from-font", textUnderlinePosition: "from-font" },
  // List items keep their raw marker ("- ", "1. ", "- [ ] "), in the text colour (Figma 140:2782 "Mark down"
  // columns). The font is monospace, so the indent is the marker's length in ch: wrapped lines hang under the item's
  // text, as do continuation lines indented to it.
  // Figma 140:2782: a list's items on consecutive 18px lines (bullet and task lists; numbered ones too, which the
  // guideline draws at 16px but then sit cramped beside them)
  ".cm-lp-li": { paddingLeft: "calc(var(--lp-in) + 2px) !important", textIndent: "calc(-1 * var(--lp-in))", lineHeight: "18px" },
  ".cm-lp-taskmark": { cursor: "pointer" },
  // Figma 140:2943: a 2px Shadows bar, 12px gap, muted text, 4px above and below the quote
  ".cm-lp-quote": { borderLeft: "2px solid var(--muted)", paddingLeft: "12px !important", color: "var(--muted)" },
  ".cm-lp-quote-first": { paddingTop: "4px" },
  ".cm-lp-quote-last": { paddingBottom: "4px" },
  // Reading mode (Figma 140:2782): a 4px dot or an 8px box, centred on the 18px line, the text 16px in; a checked
  // box filled and its text struck through.
  "&.cm-reading .cm-cursorLayer": { display: "none" },
  ".cm-lp-bullet, .cm-lp-box": { display: "inline-block", verticalAlign: "top", textIndent: "0", width: "16px" },
  ".cm-lp-bullet::before": { content: '""', display: "block", width: "4px", height: "4px", marginTop: "7px", borderRadius: "50%", background: "var(--fg)" },
  ".cm-lp-box::before": {
    content: '""', display: "block", boxSizing: "border-box", width: "8px", height: "8px", marginTop: "5px",
    border: ".4px solid var(--fg)", borderRadius: "2px",
  },
  ".cm-lp-box-on::before": { background: "var(--fg)" },
  ".cm-lp-done": { textDecoration: "line-through" },
  // Figma "_________": a .5px Onyx line at 50% across the column. Figma 148:3509 keeps 28px from the rule to the
  // blocks around it: a 24px line (12 + a blank line), and a heading right after it drops its 12px top padding.
  ".cm-lp-hr": {
    display: "inline-block", verticalAlign: "top", width: "100%", height: "24px",
    background: "linear-gradient(var(--hr), var(--hr)) center / 100% .5px no-repeat",
  },
  ".cm-lp-hrline + .cm-line + :is(.cm-lp-h1, .cm-lp-h2, .cm-lp-h3, .cm-lp-h4, .cm-lp-h5, .cm-lp-h6)": { paddingTop: "0" },
  // Figma "Code Block": Middle Grey, 4px corners, 16px above and below the code, 20px in from the sides. Reading:
  // the emptied fence lines are the 16px. Editing: the fences show, 16px from the edge and 12px from the code.
  ".cm-lp-codeblock": { background: "var(--code-bg)", padding: "0 20px !important" },
  ".cm-lp-cb-first": { borderRadius: "4px 4px 0 0" },
  ".cm-lp-cb-last": { borderBottomLeftRadius: "4px", borderBottomRightRadius: "4px" },
  ".cm-lp-fence-open": { paddingTop: "16px !important", paddingBottom: "12px !important" },
  ".cm-lp-fence-close": { paddingTop: "12px !important", paddingBottom: "16px !important" },
  // Figma 82:749: the image fits the column (block widgets skip the line's 2px padding), 28px under its markdown line;
  // the blank line after it is the 28px to the next block
  // Padding, not margin: CodeMirror measures a block widget's box, and a margin it can't see shifts every click below.
  ".cm-lp-img": { display: "block", maxWidth: "calc(100% - 4px)", margin: "0 2px", padding: "28px 0 0" },
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
const linkU = Decoration.mark({ class: "cm-lp-link cm-lp-u" });
const url = Decoration.mark({ class: "cm-lp-url" });
const underline = Decoration.mark({ class: "cm-lp-u" });
// A line may break after a url's "/" or "." (Figma 148:3509 wraps urls there) instead of the whole url jumping to the
// next line.
class Wbr extends WidgetType {
  eq() { return true; }
  toDOM() { return document.createElement("wbr"); }
}
const wbr = Decoration.widget({ widget: new Wbr(), side: 1 });
const line = (cls: string) => Decoration.line({ class: cls });
const taskMark = Decoration.mark({ class: "cm-lp-taskmark", attributes: { title: "Click to check or uncheck" } });
const hmark = Decoration.mark({ class: "cm-lp-hmark" });
const gap = line("cm-lp-gap");
// a heading or rule line (a Setext underline counts): the blank lines beside it stay 16px
const headingOrRule = /^ {0,3}(?:#{1,6}(?:\s|$)|[-=]+ *$|(?:[-*_] *){3,}$)/;
// CodeMirror estimates the height of every line it hasn't drawn from one short line of plain text it finds on screen,
// taking that line's box as the line height. A heading, list item, quote edge or code fence line is taller than the
// 16px text line (padding, 18px list lines), and sampling one made the estimate flip between 16 and 44px: a long
// doc's height swung by half a million px, jumps and table-of-contents clicks landed on the wrong text and it moved
// under the reader. Wrapping those lines' text in a mark (which draws nothing) keeps them out of the sample.
const boxed = Decoration.mark({ class: "cm-lp-boxed" });

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const reading = state.facet(readingMode);
  const out: Range<Decoration>[] = [];
  // a syntax marker: muted while editing, gone while reading
  const marker = (from: number, to: number) => to > from && out.push((reading ? hidden : muted).range(from, to));
  // a marker styled as its content while editing (`**`, backticks), gone while reading
  const plainMarker = (from: number, to: number) => reading && to > from && out.push(hidden.range(from, to));
  const urlBreaks = (from: number, to: number) => {
    const s = doc.sliceString(from, to);
    const at: Range<Decoration>[] = [];
    for (let i = 0; i < s.length - 1; i++) if ((s[i] === "/" && s[i + 1] !== "/") || s[i] === ".") at.push(wbr.range(from + i + 1));
    return at;
  };
  const lines = (from: number, to: number, vfrom: number, vto: number, deco: (l: number, first: number, last: number) => Decoration) => {
    const first = doc.lineAt(from).number, last = doc.lineAt(to).number;
    for (let l = doc.lineAt(Math.max(from, vfrom)).number; l <= doc.lineAt(Math.min(to, vto)).number; l++)
      out.push(deco(l, first, last).range(doc.line(l).from));
  };
  // the line at `pos`, not 16px tall: kept out of CodeMirror's line height sample (see `boxed`)
  const tall = (pos: number) => {
    const l = doc.lineAt(pos);
    if (l.to > l.from) out.push(boxed.range(l.from, l.to));
  };
  const listed = new Set<number>(); // line starts already indented (items can span visible ranges)
  const code: { from: number; to: number }[] = []; // code blocks: their blank lines are code
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
      width = `calc(${mark.from - first.from}ch + 16px)`;
    }
    const style = `--lp-in:${width}`;
    const indent = Decoration.line({ class: "cm-lp-li", attributes: { style } });
    const indentLine = (from: number) => {
      if (from < vfrom || from > vto || listed.has(from)) return;
      listed.add(from);
      out.push(indent.range(from));
      tall(from);
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
          tall(n.from);
          return;
        }
        switch (name) {
          case "HeaderMark": {
            // the leading "## " (with its space) hangs in the margin (cm-lp-hmark); a closing "##" and Setext
            // underlines stay put. A heading with no text yet keeps its mark in the line, pulled into the margin, so
            // the caret after it sits where the text will start.
            const end = doc.sliceString(n.to, n.to + 1) === " " ? n.to + 1 : n.to;
            if (n.parent?.name.startsWith("Setext") || n.prevSibling) marker(n.from, n.to);
            else if (reading) out.push(hidden.range(n.from, end));
            else if (end < doc.lineAt(n.from).to) out.push(hmark.range(n.from, end));
            else out.push(Decoration.mark({ class: "cm-lp-hmark cm-lp-hmark-empty", attributes: { style: `margin-left:calc(-${n.to - n.from}ch - 12px)` } }).range(n.from, end));
            return;
          }
          case "StrongEmphasis": case "Emphasis": case "Strikethrough": case "InlineCode":
            out.push(marks[name]!.range(n.from, n.to));
            return;
          case "EmphasisMark": case "StrikethroughMark":
            plainMarker(n.from, n.to);
            return;
          case "CodeMark":
            if (n.parent?.name === "InlineCode") plainMarker(n.from, n.to);
            return;
          case "Link": {
            const marksIn = n.getChildren("LinkMark");
            const open = marksIn[0], close = marksIn[1];
            if (!open || !close || doc.sliceString(open.from, open.to) !== "[") return false; // autolink etc.
            if (reading) {
              if (close.from > open.to) out.push(linkU.range(open.to, close.from));
              out.push(hidden.range(open.from, open.to), hidden.range(close.from, n.to));
              return false;
            }
            out.push(link.range(open.from, close.to));
            if (n.to > close.to) out.push(url.range(close.to, n.to));
            const href = n.getChild("URL");
            if (href) out.push(underline.range(href.from, href.to), ...urlBreaks(href.from, href.to));
            return false;
          }
          case "URL": // a bare or <autolink>
            if (n.parent?.name !== "Image") out.push(linkU.range(n.from, n.to), ...urlBreaks(n.from, n.to));
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
            tall(n.from);
            tall(n.to);
            return;
          case "QuoteMark":
            marker(n.from, reading && doc.sliceString(n.to, n.to + 1) === " " ? n.to + 1 : n.to);
            return;
          case "HorizontalRule":
            out.push(line("cm-lp-hrline").range(doc.lineAt(n.from).from), rule.range(n.from, n.to));
            return;
          case "CodeBlock":
            code.push(n);
            return false;
          case "FencedCode": {
            code.push(n);
            const closed = n.lastChild?.name === "CodeMark" && doc.lineAt(n.lastChild.from).number > doc.lineAt(n.from).number;
            lines(n.from, n.to, vfrom, vto, (l, first, last) => {
              let cls = "cm-lp-codeblock";
              if (l === first) cls += reading ? " cm-lp-cb-first" : " cm-lp-cb-first cm-lp-fence-open";
              if (l === last) cls += reading || !closed ? " cm-lp-cb-last" : " cm-lp-cb-last cm-lp-fence-close";
              return line(cls);
            });
            if (reading) for (let c = n.firstChild; c; c = c.nextSibling) if (c.name === "CodeMark" || c.name === "CodeInfo") marker(c.from, c.to);
            tall(n.from);
            tall(n.to);
            return false;
          }
        }
      },
    });
    // 28px between blocks: a blank line after a block (not the next blank in a run), unless a heading or rule
    // borders it. Decided by the line before it, so typing on a new line below never moves that line.
    for (let l = doc.lineAt(vfrom).number; l <= doc.lineAt(vto).number; l++) {
      const ln = doc.line(l);
      if (ln.text.trim() || l === 1 || code.some((c) => c.from <= ln.from && ln.from <= c.to)) continue;
      const prev = doc.line(l - 1).text;
      if (!prev.trim() || headingOrRule.test(prev) || (l < doc.lines && headingOrRule.test(doc.line(l + 1).text))) continue;
      out.push(gap.range(ln.from));
    }
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
    // lang-markdown's markdown() minus what this editor never uses: it wraps the parser to parse HTML inside the doc
    // (comment markup included) as HTML, which walked the whole tree again on every keystroke, and adds HTML tag
    // completion and heading folding. Kept: list-continuing Enter / Backspace and pasting a URL over a selection.
    new LanguageSupport(markdownLanguage, [Prec.high(keymap.of(markdownKeymap)), pasteURLAsLink]),
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
