// GFM tables, Obsidian-style: always a table whose cells are edited in place. While editing, cells show their
// markdown styled as the text around them (Figma 148:3509), so focusing one changes no character; reading renders it.
// Tab / Shift-Tab / Enter move between cells (adding a row past the end), arrows and Escape
// leave the table, right-click inserts or deletes rows and columns.
// Editing a cell rewrites only that cell's text in the file (agents' diffs stay one cell wide); column changes
// rewrite every row of the table.
import { syntaxTree } from "@codemirror/language";
import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, runScopeHandlers } from "@codemirror/view";
import { plain } from "../comments/inline.ts";
import { blockField } from "./blocks.ts";

type Cell = { from: number; to: number; end: number }; // trimmed text (from === to: empty); end: the next pipe
type Row = { from: number; to: number; cells: Cell[] };
type Table = { from: number; to: number; rows: Row[] }; // rows[1] is the delimiter row

// Cells of one row: text between unescaped pipes; the outer pipes are optional (GFM).
function splitRow(text: string, base: number): Cell[] {
  const bounds = [-1];
  for (let i = 0; i < text.length; i++) if (text[i] === "|" && text[i - 1] !== "\\") bounds.push(i);
  bounds.push(text.length);
  const segs: [number, number][] = [];
  for (let k = 0; k + 1 < bounds.length; k++) segs.push([bounds[k]! + 1, bounds[k + 1]!]);
  const blank = (s: [number, number]) => !text.slice(s[0], s[1]).trim();
  if (segs.length > 1 && blank(segs[0]!)) segs.shift();
  if (segs.length > 1 && blank(segs.at(-1)!)) segs.pop();
  return segs.map(([s, e]) => {
    let from = s, to = e;
    while (from < to && text[from] === " ") from++;
    while (to > from && text[to - 1] === " ") to--;
    if (from === to) from = to = Math.min(s + 1, e); // empty: inside the padding, so "|  |" becomes "| x |"
    return { from: base + from, to: base + to, end: base + e };
  });
}

function tableAt(state: EditorState, pos: number): Table | null {
  for (let n = syntaxTree(state).resolveInner(pos, 1); n.parent; n = n.parent) {
    if (n.name !== "Table") continue;
    const doc = state.doc;
    const rows: Row[] = [];
    for (let l = doc.lineAt(n.from).number; l <= doc.lineAt(n.to).number; l++) {
      const line = doc.line(l);
      rows.push({ from: line.from, to: line.to, cells: splitRow(line.text, line.from) });
    }
    return { from: rows[0]!.from, to: rows.at(-1)!.to, rows };
  }
  return null;
}

const unescape = (s: string) => s.replaceAll("\\|", "|");
const toCell = (s: string) => s.replace(/\s*\n\s*/g, " ").replace(/(?<!\\)\|/g, "\\|");
const rowText = (cells: string[]) => `| ${cells.join(" | ")} |`;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
// Cell text -> HTML: code spans, bold, italic, links. Reading: rendered (a link shows its name). Editing (markdown):
// the markers stay, in their content's style; a link's (url) is grey. Everything from the doc is escaped first. A
// link's parts carry its url (data-href) for Cmd/Ctrl-click. Comment markers (`marked` cells) become threadSpans.
export const cellHtml = (s: string, markdown: boolean) =>
  threadSpans(
    s
      .replace(/<!--(\/?)rl:([a-z0-9]+)-->/g, (_, close: string, id: string) => `${close ? CLOSE : OPEN}${id}${END}`)
      .split(/(`[^`]+`)/)
      .map((part, i) =>
        i % 2
          ? `<code>${esc(markdown ? part : part.slice(1, -1))}</code>`
          : esc(part)
              .replace(/\*\*(.+?)\*\*/g, markdown ? "<strong>**$1**</strong>" : "<strong>$1</strong>")
              .replace(/(^|[^*])\*([^*]+)\*/g, markdown ? "$1<em>*$2*</em>" : "$1<em>$2</em>")
              .replace(/\[([^\]]+)\]\(([^)]*)\)/g, (_, name: string, href: string) =>
                markdown
                  ? `<span class="cm-lp-link" data-href="${href}">[${name}]</span><span class="cm-lp-url" data-href="${href}">(<span class="cm-lp-u">${href.replace(/(\/(?!\/)|\.)(?=.)/g, "$1<wbr>")}</span>)</span>`
                  : `<span class="cm-lp-link cm-lp-u" data-href="${href}">${name}</span>`,
              ),
      )
      .join(""),
  );

// A comment's markers, as cellHtml carries them through escaping and markdown (private-use characters).
const OPEN = "\uE000", CLOSE = "\uE001", END = "\uE002";
const MARKER = /[\uE000\uE001][a-z0-9]+\uE002/g;
// The commented text in [data-thread] spans (Editor.tsx's stylesheet lights the shown ones; a click opens the thread).
// Spans wrap text runs only, never tags, so a comment starting inside a code span or across a link nests cleanly. A
// marker copied into an attribute (a link's url) is dropped there.
function threadSpans(html: string): string {
  if (!html.includes(END)) return html;
  const open: string[] = [];
  return html.replace(/<[^>]*>|[\uE000\uE001][a-z0-9]+\uE002|[^<\uE000\uE001]+/g, (m) => {
    if (m[0] === "<") return m.replace(MARKER, "");
    const id = m.slice(1, -1), at = open.lastIndexOf(id);
    if (m[0] === OPEN) open.push(id);
    else if (m[0] === CLOSE) at >= 0 && open.splice(at, 1);
    else return open.map((t) => `<span data-thread="${t}">`).join("") + m + "</span>".repeat(open.length);
    return "";
  });
}
// The url of the link at `offset` in a cell's raw text: a `[name](url)` or a bare http(s) url.
function linkAt(text: string, offset: number): string | null {
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)[^)]*\)|https?:\/\/[^\s)|]+/g))
    if (m.index <= offset && offset <= m.index + m[0].length) return m[1] ?? m[0];
  return null;
}

// After a change that redraws the table (new row, new column), the cell to put the caret back in.
let refocus: { r: number; c: number; end: boolean } | null = null;
const raws = new WeakMap<HTMLElement, string[][]>(); // the table element -> current raw cell texts
const drawn = new WeakMap<HTMLElement, string[][]>(); // the same with their comment markers, as drawn
// The cell being edited and its table's start. When a redraw removes that cell, Chrome drops the focus to
// nowhere (lostAt); the redrawn table takes it back if that happened just now. Focus moved by the user clears it.
let editing: { from: number; r: number; c: number; lostAt: number } | null = null;
// Per drawn table, when it resizes (never on scroll): how far its header row travels down it while it scrolls by
// (tableTheme's scroll timeline), whether it's wider than its column (only then is the first column pinned: thousands
// of sticky cells doubled a keystroke's cost in a 2,000-row table), and its height for estimatedHeight. --travel goes
// on the <thead>: on the wrap, every cell inherited it, and each change (a keystroke that rewraps a long table)
// restyled the whole table. All reads before the writes, so no read forces a layout. Made with the first table: the
// check scripts load this module without a DOM.
let resized: ResizeObserver | undefined;
const shape = (cells: string[][]) => `${cells.length}\n${cells[0]?.join("|")}`;
const drawnHeights = new Map<string, number>(); // by shape: row count and header row
const measure = (entries: ResizeObserverEntry[]) => {
  const read = entries.flatMap(({ target: t }) => {
    const wrap = t.parentElement, cells = wrap && raws.get(wrap);
    if (!(t instanceof HTMLTableElement) || !t.tHead || !wrap || !cells) return [];
    return [{ wrap, head: t.tHead, cells, travel: t.offsetHeight - t.tHead.offsetHeight, height: wrap.offsetHeight, wide: t.offsetWidth > wrap.clientWidth }];
  });
  for (const { wrap, head, cells, travel, height, wide } of read) {
    head.style.setProperty("--travel", `${travel}px`);
    wrap.classList.toggle("cm-lp-wide", wide);
    drawnHeights.set(shape(cells), height);
  }
};

// Cell texts by row text: `plain` without comment markup (what a focused cell shows and edits), `marked` with it (what
// a drawn cell shows, its comments lit). Every edit makes a new widget for the whole table; parsing each row again
// (pipes, comment markup) took ~15 ms a keystroke in a 2,000-row table. Never mutated.
// ponytail: emptied whole past 50k rows, an LRU if docs with that many table rows get edited often
type ParsedRow = { plain: string[]; marked: string[] };
const parsedRows = new Map<string, ParsedRow>();
function parseRow(line: string): ParsedRow {
  let row = parsedRows.get(line);
  if (row) return row;
  if (parsedRows.size > 50_000) parsedRows.clear();
  const marked = splitRow(line, 0).map((c) => unescape(line.slice(c.from, c.to)));
  row = { marked, plain: marked.map((c) => plain(c).text) };
  parsedRows.set(line, row);
  return row;
}

class TableWidget extends WidgetType {
  readonly cells: string[][]; // raw text per source row (delimiter row included), without comment markers
  readonly marked: string[][]; // the same with them
  readonly align: string[];
  // readOnly: switching between reading and editing patches the cells' contentEditable (updateDOM)
  constructor(readonly src: string, readonly readOnly: boolean) {
    super();
    const rows = src.split("\n").map(parseRow);
    this.cells = rows.map((r) => r.plain);
    this.marked = rows.map((r) => r.marked);
    this.align = (this.cells[1] ?? []).map((d) => (d.endsWith(":") ? (d.startsWith(":") ? "center" : "right") : "left"));
  }
  get width() {
    return this.cells[0]?.length ?? 0;
  }
  // Until drawn, CodeMirror counts a widget as one line (16px) unless told: a table replacing ten lines then shrank the
  // doc's estimated height, and the text under the reader moved when a far table was parsed. One-line rows are 32px.
  // A table drawn before with the same rows and header is as tall as then: each edit makes a new widget, and with
  // the row estimate the viewport moved on every keystroke in a long table, redrawing a 200-row table at its edge
  // twice a key (half a second).
  get estimatedHeight() {
    return drawnHeights.get(shape(this.cells)) ?? (this.cells.length - 1) * 32;
  }
  eq(o: TableWidget) {
    return o.src === this.src && o.readOnly === this.readOnly;
  }
  destroy(dom: HTMLElement) {
    if (dom.firstElementChild) resized?.unobserve(dom.firstElementChild);
  }
  // Same rows and columns: patch the cells in place, so the cell being typed in keeps its caret. Only cells whose text
  // changed are touched: rewriting every cell's HTML on each keystroke took 2-4 s a key in a 2,000-row table
  // (`bun bench/stress.ts --doc tables`), mostly relaying out the whole table.
  updateDOM(dom: HTMLElement, view: EditorView) {
    const old = drawn.get(dom);
    if (!old || old.length !== this.cells.length || old[0]?.length !== this.width || refocus) {
      // rows or columns changed (undo, a peer, an agent): the redrawn table gets the caret back
      const at = cellOf(document.activeElement);
      if (!refocus && at && dom.contains(at)) refocus = { r: Number(at.dataset.r), c: Number(at.dataset.c), end: true };
      return false;
    }
    const mode = String(this.readOnly), redraw = dom.dataset.readOnly !== mode; // reading ⇄ editing: every cell
    dom.dataset.readOnly = mode;
    // the delimiter row (r 1) has no cells: querySelector finds none
    const changed = redraw
      ? [...dom.querySelectorAll<HTMLElement>("[data-r]")]
      : this.marked.flatMap((row, r) => row.flatMap((m, c) => (old[r]?.[c] === m ? [] : (dom.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`) ?? []))));
    const active = cellOf(document.activeElement);
    if (active && dom.contains(active) && !changed.includes(active)) changed.push(active);
    for (const el of changed) {
      const r = Number(el.dataset.r), c = Number(el.dataset.c), raw = this.raw(r, c);
      if (el !== active) el.innerHTML = cellHtml(this.marked[r]?.[c] ?? "", !this.readOnly);
      // The file trims cells, so a space just typed at an end isn't stored yet: compare what would be stored.
      else if (unescape(toCell(el.textContent ?? "")).trim() !== raw) {
        el.textContent = raw; // undo or a remote edit changed the cell being edited
        caretEnd(el);
      }
      if (redraw) el.contentEditable = view.state.readOnly ? "false" : "true";
    }
    raws.set(dom, this.cells);
    drawn.set(dom, this.marked);
    return true;
  }
  raw(r: number, c: number) {
    return this.cells[r]?.[c] ?? "";
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-lp-tablewrap";
    wrap.dataset.readOnly = String(this.readOnly);
    const table = wrap.appendChild(document.createElement("table"));
    table.className = "cm-lp-table";
    const head = table.createTHead();
    const body = table.createTBody();
    this.cells.forEach((_, r) => {
      if (r === 1) return; // the delimiter row only carries alignment
      const tr = (r === 0 ? head : body).insertRow();
      for (let c = 0; c < this.width; c++) {
        const el = tr.appendChild(document.createElement(r === 0 ? "th" : "td"));
        el.dataset.r = String(r);
        el.dataset.c = String(c);
        el.style.textAlign = this.align[c] ?? "left";
        el.contentEditable = view.state.readOnly ? "false" : "true";
        el.spellcheck = false;
        el.innerHTML = cellHtml(this.marked[r]?.[c] ?? "", !this.readOnly);
      }
    });
    raws.set(wrap, this.cells);
    drawn.set(wrap, this.marked);
    wire(wrap, view);
    (resized ??= new ResizeObserver(measure)).observe(table);
    const f = refocus;
    refocus = null;
    requestAnimationFrame(() => {
      if (f) return focusCell(wrap, f.r, f.c, f.end);
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost && editing && performance.now() - editing.lostAt < 500 && wrap.isConnected && view.posAtDOM(wrap) === editing.from) focusCell(wrap, editing.r, editing.c);
    });
    return wrap;
  }
}

function caretEnd(el: HTMLElement) {
  const sel = getSelection();
  sel?.selectAllChildren(el);
  sel?.collapseToEnd();
}

// The cell, or the nearest one left in its column/row when that row or column is gone.
function focusCell(wrap: HTMLElement, r: number, c: number, end = true) {
  const cells = [...wrap.querySelectorAll<HTMLElement>("[data-r]")];
  const el =
    cells.find((x) => x.dataset.r === String(r) && x.dataset.c === String(c)) ??
    cells.filter((x) => Number(x.dataset.r) <= r && Number(x.dataset.c) <= c).at(-1) ??
    cells[0];
  if (!el) return;
  el.focus();
  if (end) caretEnd(el);
}

const cellOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>("[data-r]") : null);

// Text selected inside the focused cell, as doc positions. The editor's own selection can't point into the
// table widget, so the Comment button and startComment use this instead while it's set.
const setCellSelection = StateEffect.define<{ from: number; to: number } | null>();
export const cellSelection = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setCellSelection)) return e.value;
    return v && tr.docChanged ? { from: tr.changes.mapPos(v.from, 1), to: tr.changes.mapPos(v.to, -1) } : v;
  },
});

function selectedInCell(view: EditorView): { from: number; to: number } | null {
  const sel = getSelection();
  if (!sel?.rangeCount || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const el = cellOf(node instanceof Element ? node : node.parentElement);
  const wrap = el?.closest<HTMLElement>(".cm-lp-tablewrap");
  if (!el || !wrap || el !== document.activeElement || !view.contentDOM.contains(wrap)) return null;
  const cell = tableAt(view.state, view.posAtDOM(wrap))?.rows[Number(el.dataset.r)]?.cells[Number(el.dataset.c)];
  if (!cell) return null;
  // The focused cell shows its raw text, with "\|" shown as "|" and no comment markers: count source characters up
  // to a shown offset, then step over the markers (side 1: after markers there, -1: before).
  const src = plain(view.state.doc.sliceString(cell.from, cell.to));
  const pos = (container: Node, offset: number, side: -1 | 1) => {
    const before = document.createRange();
    before.selectNodeContents(el);
    before.setEnd(container, offset);
    let i = 0;
    for (let n = before.toString().length; n > 0 && i < src.text.length; n--) i += src.text.startsWith("\\|", i) ? 2 : 1;
    return cell.from + src.toText(i, side);
  };
  const from = pos(range.startContainer, range.startOffset, 1), to = pos(range.endContainer, range.endOffset, -1);
  return from < to ? { from, to } : null;
}

const cellSelectionSync = ViewPlugin.define((view) => {
  const sync = () => {
    // the comment box (a tooltip) took focus: the selection it's about stays
    if (document.activeElement?.closest(".cm-tooltip")) return;
    const next = selectedInCell(view), cur = view.state.field(cellSelection);
    if (next?.from !== cur?.from || next?.to !== cur?.to) view.dispatch({ effects: setCellSelection.of(next) });
  };
  document.addEventListener("selectionchange", sync);
  return { destroy: () => document.removeEventListener("selectionchange", sync) };
});
export const cellComments = [cellSelection, cellSelectionSync];

// The cell holding doc text [from, to], once the editor has scrolled its table into view and drawn it: the editor's
// own selection and decorations can't reach inside the table widget. false: the range isn't inside one cell.
function inCell(view: EditorView, from: number, to: number, then: (el: HTMLElement, cell: Cell) => void): boolean {
  const t = tableAt(view.state, from);
  const r = t?.rows.findIndex((row) => row.from <= from && to <= row.to) ?? -1;
  const c = r < 0 ? -1 : t!.rows[r]!.cells.findIndex((x) => x.from <= from && to <= x.to);
  if (!t || c < 0) return false;
  const cell = t.rows[r]!.cells[c]!;
  view.dispatch({ effects: EditorView.scrollIntoView(t.from, { y: "center" }) });
  let tries = 0;
  const find = () => {
    const wrap = [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-lp-tablewrap")].find((w) => view.posAtDOM(w) === t.from);
    const el = wrap?.querySelector<HTMLElement>(`[data-r="${r}"][data-c="${c}"]`);
    if (el) then(el, cell);
    else if (tries++ < 10) requestAnimationFrame(find);
  };
  requestAnimationFrame(find);
  return true;
}

// Selects doc text [from, to] inside a table cell, as the editor does elsewhere (a comment's quote in a cell). Reading
// mode, where cells take no caret, only brings the cell into view.
export function selectInTable(view: EditorView, from: number, to: number): boolean {
  return inCell(view, from, to, (el, cell) => {
    if (!el.isContentEditable) return el.scrollIntoView({ block: "nearest" });
    // the focused cell shows its raw text in one text node: "\|" as "|", no comment markers
    const src = plain(view.state.doc.sliceString(cell.from, cell.to));
    const shown = (pos: number) => {
      const p = src.toPlain(pos - cell.from);
      return p - (src.text.slice(0, p).match(/\\\|/g)?.length ?? 0);
    };
    el.focus();
    const node = el.firstChild ?? el, len = el.textContent?.length ?? 0;
    getSelection()?.setBaseAndExtent(node, Math.min(shown(from), len), node, Math.min(shown(to), len));
  });
}

// Brings the link at doc range [from, to] in a table cell to the middle of the view and flashes it (`.rl-flash`), as
// an outline link click does elsewhere: no caret, no focus. A cell being edited shows raw text, so it flashes whole.
export function flashInTable(view: EditorView, from: number, to: number): boolean {
  return inCell(view, from, to, (el, cell) => {
    const nth = [...plain(view.state.doc.sliceString(cell.from, from)).text.matchAll(/\[[^\]]+\]\([^)]*\)/g)].length;
    const parts = [...el.querySelectorAll<HTMLElement>("[data-href]")];
    const per = view.state.readOnly ? 1 : 2; // reading draws a link as its name; editing as [name] and (url)
    const marks = el === document.activeElement || !parts.length ? [el] : parts.slice(nth * per, nth * per + per);
    (marks[0] ?? el).scrollIntoView({ block: "center" });
    for (const m of marks) {
      m.classList.remove("rl-flash");
      void m.offsetWidth; // restart the animation on a second click
      m.classList.add("rl-flash");
      setTimeout(() => m.classList.remove("rl-flash"), 1600); // the animation's length
    }
  });
}

function wire(wrap: HTMLElement, view: EditorView) {
  const tableNow = () => tableAt(view.state, view.posAtDOM(wrap));
  const rowsShown = () => (raws.get(wrap) ?? []).map((_, r) => r).filter((r) => r !== 1);

  // the pinned first column turns opaque once the rest slides under it
  wrap.addEventListener("scroll", () => wrap.classList.toggle("cm-lp-scrolled", wrap.scrollLeft > 0), { passive: true });

  // Cmd/Ctrl-click opens the link under the pointer, as in the rest of the doc (a cell being edited shows raw text)
  wrap.addEventListener("mousedown", (e) => {
    const el = cellOf(e.target);
    if (!el || e.button !== 0 || !(e.metaKey || e.ctrlKey)) return;
    let href = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-href]")?.dataset.href : undefined;
    if (!href && el === document.activeElement) {
      // caretRangeFromPoint: Safari before 18.4
      const p = document.caretPositionFromPoint?.(e.clientX, e.clientY);
      const r = p ? null : document.caretRangeFromPoint?.(e.clientX, e.clientY);
      const node = p?.offsetNode ?? r?.startContainer, offset = p?.offset ?? r?.startOffset ?? 0;
      if (node && el.contains(node)) href = linkAt(el.textContent ?? "", offset) ?? undefined;
    }
    if (!href || !/^(https?:|mailto:)/i.test(href)) return;
    e.preventDefault(); // no caret, no focus change
    window.open(href, "_blank", "noopener");
  });
  wrap.addEventListener("focusin", (e) => {
    const el = cellOf(e.target);
    if (!el) return;
    editing = { from: view.posAtDOM(wrap), r: Number(el.dataset.r), c: Number(el.dataset.c), lostAt: -Infinity };
    el.textContent = raws.get(wrap)?.[Number(el.dataset.r)]?.[Number(el.dataset.c)] ?? "";
  });
  wrap.addEventListener("focusout", (e) => {
    const el = cellOf(e.target);
    if (el) el.innerHTML = cellHtml(drawn.get(wrap)?.[Number(el.dataset.r)]?.[Number(el.dataset.c)] ?? "", !view.state.readOnly);
    if (cellOf(e.relatedTarget)) return; // another cell
    if (e.relatedTarget) editing = null; // the user moved focus elsewhere
    else if (editing) editing.lostAt = performance.now(); // to nowhere: a redraw (or the window lost focus)
  });
  wrap.addEventListener("paste", (e) => {
    if (!cellOf(e.target)) return;
    e.preventDefault(); // plain text only: a cell is one line of markdown
    document.execCommand("insertText", false, (e.clipboardData?.getData("text/plain") ?? "").replace(/\s*\n\s*/g, " "));
  });
  wrap.addEventListener("input", (e) => {
    const el = cellOf(e.target);
    if (!el) return;
    const r = Number(el.dataset.r), c = Number(el.dataset.c);
    // only this row's line: parsing the whole table per keystroke was ~15 ms in a 2,000-row one
    const doc = view.state.doc, n = doc.lineAt(view.posAtDOM(wrap)).number + r;
    if (n > doc.lines) return;
    const line = doc.line(n), row: Row = { from: line.from, to: line.to, cells: splitRow(line.text, line.from) };
    const text = toCell(el.textContent ?? "");
    const cell = row.cells[c];
    if (cell) {
      // Only the changed span: keystrokes become plain inserts, so undo groups them like normal typing and a
      // peer typing elsewhere in the same cell isn't overwritten. One space of padding is kept when the cell had
      // some, so typed spaces don't pile up at the end. The cell shows no comment markers, so the change is found
      // without them and mapped back; commentMarks' guard keeps it off the markers, as in the rest of the doc.
      const old = plain(view.state.doc.sliceString(cell.from, cell.end));
      const next = text.trimEnd() + (cell.end > cell.to ? " " : "");
      const o = old.text;
      let p = 0;
      while (p < o.length && p < next.length && o[p] === next[p]) p++;
      let s = 0;
      while (s < o.length - p && s < next.length - p && o[o.length - 1 - s] === next[next.length - 1 - s]) s++;
      if (p === o.length && p === next.length) return;
      const from = cell.from + old.toText(p, -1);
      const to = o.length - s > p ? cell.from + old.toText(o.length - s, 1) : from;
      view.dispatch({ changes: { from, to, insert: next.slice(p, next.length - s) }, userEvent: "input.type" });
      return;
    }
    // a short row: pad it to this column
    const texts = row.cells.map((x) => view.state.doc.sliceString(x.from, x.to));
    while (texts.length <= c) texts.push("");
    texts[c] = text;
    refocus = { r, c, end: true };
    view.dispatch({ changes: { from: row.from, to: row.to, insert: rowText(texts) }, userEvent: "input.type" });
  });

  wrap.addEventListener("keydown", (e) => {
    const el = cellOf(e.target);
    const t = tableNow();
    if (!el || !t) return;
    // Undo/redo are the editor's (one history with the rest of the doc), not the cell's native undo.
    if ((e.ctrlKey || e.metaKey) && /^[zy]$/i.test(e.key)) {
      e.preventDefault();
      runScopeHandlers(view, e, "editor");
      return;
    }
    // the row / column menu without a mouse: the context-menu key or Shift-F10, its first item focused
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      if (view.state.readOnly) return;
      const box = el.getBoundingClientRect();
      return menu(view, t, Number(el.dataset.r), Number(el.dataset.c), box.left, box.bottom, el);
    }
    // Alt-Enter opens the link at the caret, as in the rest of the doc
    if (e.altKey && e.key === "Enter") {
      const sel = getSelection(), href = linkAt(el.textContent ?? "", sel && el.contains(sel.focusNode) ? sel.focusOffset : 0);
      e.preventDefault();
      if (href && /^(https?:|mailto:)/i.test(href)) window.open(href, "_blank", "noopener");
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const r = Number(el.dataset.r), c = Number(el.dataset.c);
    const shown = rowsShown();
    const i = shown.indexOf(r);
    const width = raws.get(wrap)?.[0]?.length ?? 0;
    const go = (rr: number, cc: number) => (e.preventDefault(), focusCell(wrap, rr, cc));
    if (e.key === "Tab") {
      const k = i * width + c + (e.shiftKey ? -1 : 1);
      if (k < 0) return go(shown[0]!, 0);
      if (k < shown.length * width) return go(shown[Math.floor(k / width)]!, k % width);
      e.preventDefault();
      return addRow(view, t, r, 0);
    }
    if (e.key === "Enter") {
      if (e.shiftKey) return e.preventDefault(); // GFM cells are one line
      if (i + 1 < shown.length) return go(shown[i + 1]!, c);
      e.preventDefault();
      return addRow(view, t, r, c);
    }
    if (e.key === "ArrowUp" && i > 0) return go(shown[i - 1]!, c);
    if (e.key === "ArrowDown" && i + 1 < shown.length) return go(shown[i + 1]!, c);
    if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Escape") {
      e.preventDefault();
      leave(view, t, e.key === "ArrowUp" ? -1 : 1);
    }
  });

  wrap.addEventListener("contextmenu", (e) => {
    const el = cellOf(e.target);
    const t = tableNow();
    if (!el || !t || view.state.readOnly) return;
    e.preventDefault();
    menu(view, t, Number(el.dataset.r), Number(el.dataset.c), e.clientX, e.clientY);
  });
}

// An empty row after source row `r` (after the delimiter when r is the header); the caret goes to column `c`.
function addRow(view: EditorView, t: Table, r: number, c: number) {
  const after = t.rows[r === 0 ? 1 : r]!;
  refocus = { r: r === 0 ? 2 : r + 1, c, end: true };
  view.dispatch({ changes: { from: after.to, insert: "\n" + rowText(Array(t.rows[0]!.cells.length).fill("")) }, userEvent: "input" });
}

// Caret to the line above or below the table (adding an empty line below a table that ends the doc).
function leave(view: EditorView, t: Table, dir: -1 | 1) {
  const doc = view.state.doc;
  view.focus();
  if (dir < 0) return view.dispatch({ selection: { anchor: Math.max(0, t.from - 1) }, scrollIntoView: true });
  if (t.to >= doc.length) return view.dispatch({ changes: { from: doc.length, insert: "\n" }, selection: { anchor: doc.length + 1 }, userEvent: "input" });
  view.dispatch({ selection: { anchor: t.to + 1 }, scrollIntoView: true });
}

// Rewrite every row with a column inserted at / removed from index `c`.
function columns(view: EditorView, t: Table, edit: (texts: string[], r: number) => void, focus: { r: number; c: number }) {
  const width = t.rows[0]!.cells.length;
  const changes = t.rows.map((row, r) => {
    const texts = row.cells.map((x) => view.state.doc.sliceString(x.from, x.to));
    while (texts.length < width) texts.push(r === 1 ? "---" : "");
    edit(texts, r);
    return { from: row.from, to: row.to, insert: rowText(texts) };
  });
  refocus = { ...focus, end: true };
  view.dispatch({ changes, userEvent: "input" });
}

// The row / column menu at (x, y). Opened from the keyboard (`cell`: the cell it's for), its first item takes focus,
// Up/Down/Home/End move, Esc or Tab away closes it and Esc puts the caret back in the cell.
function menu(view: EditorView, t: Table, r: number, c: number, x: number, y: number, cell?: HTMLElement) {
  const width = t.rows[0]!.cells.length;
  const items: [string, boolean, () => void][] = [
    ["Insert row above", r > 1, () => addRow(view, t, r === 2 ? 0 : r - 1, c)],
    ["Insert row below", true, () => addRow(view, t, r, c)],
    [
      "Delete row",
      r > 1,
      () => {
        const row = t.rows[r]!;
        if (t.rows.length > 3) refocus = { r: Math.min(r, t.rows.length - 2), c, end: true };
        view.dispatch({ changes: { from: t.rows[r - 1]!.to, to: row.to }, userEvent: "delete" });
      },
    ],
    ["Insert column left", true, () => columns(view, t, (x, i) => x.splice(c, 0, i === 1 ? "---" : ""), { r, c })],
    ["Insert column right", true, () => columns(view, t, (x, i) => x.splice(c + 1, 0, i === 1 ? "---" : ""), { r, c: c + 1 })],
    ["Delete column", width > 1, () => columns(view, t, (x) => x.splice(c, 1), { r, c: Math.min(c, width - 2) })],
  ];
  const box = document.createElement("div");
  box.className = "cm-lp-menu";
  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
  // once: removing the box with focus in it fires its focusout, which closes it too (a second remove throws)
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    removeEventListener("mousedown", outside, true);
    removeEventListener("keydown", onKey, true);
    box.remove();
  };
  const outside = (e: MouseEvent) => !box.contains(e.target as Node) && close();
  const buttons = () => [...box.querySelectorAll<HTMLButtonElement>("button:enabled")];
  const onKey = (e: KeyboardEvent) => {
    const inside = box.contains(document.activeElement), list = buttons(), i = list.indexOf(document.activeElement as HTMLButtonElement);
    const to = { ArrowDown: list[i + 1] ?? list[0], ArrowUp: list[i - 1] ?? list.at(-1), Home: list[0], End: list.at(-1) }[e.key];
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // the menu's, not the cell's (which leaves the table)
      close();
      if (inside) cell?.focus();
    } else if (inside && to) {
      e.preventDefault();
      to.focus();
    }
  };
  for (const [label, enabled, run] of items) {
    const b = box.appendChild(document.createElement("button"));
    b.textContent = label;
    b.disabled = !enabled;
    b.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the cell
    b.addEventListener("click", () => {
      const inside = box.contains(document.activeElement);
      close();
      if (inside) cell?.focus(); // as after a mouse pick: the caret in the cell, then the edit moves it
      run();
    });
  }
  box.addEventListener("focusout", (e) => !box.contains(e.relatedTarget as Node) && close());
  view.dom.appendChild(box);
  addEventListener("mousedown", outside, true);
  addEventListener("keydown", onKey, true);
  if (cell) buttons()[0]?.focus();
}

// Block widgets can't come from a view plugin, so tables live in a state field (blocks.ts: a change rescans only the
// blocks it touched). Tables sit at the top level or inside lists and quotes.
export const tableField = blockField(
  (state, block, out) =>
    block.cursor().iterate((n) => {
      if (n.name === "Paragraph" || n.name === "FencedCode" || n.name.includes("Heading")) return false; // no tables inside
      if (n.name !== "Table") return;
      const first = state.doc.lineAt(n.from), last = state.doc.lineAt(n.to);
      out.push(Decoration.replace({ widget: new TableWidget(state.doc.sliceString(first.from, last.to), state.readOnly), block: true }).range(first.from, last.to));
      return false;
    }),
  (tr) => tr.state.readOnly !== tr.startState.readOnly,
);

export const tableTheme = EditorView.theme({
  // a wide table wraps its cells, then scrolls
  // padding, not margin: CodeMirror can't see a block widget's margins, and clicks below it would land too low
  // Figma 140:2782 "Table": full width, .5px Onyx lines over and under every row (drawn as backgrounds, so they take
  // no room: rows are 8 + text + 8), no column lines, 12px between columns, the header row SemiBold; 20px above and
  // below
  ".cm-lp-tablewrap": { overflowX: "auto", paddingTop: "20px", paddingBottom: "20px" },
  // CodeMirror's wrapping (overflow-wrap: anywhere, word-break: break-word) makes every column's minimum one
  // letter, so a squeezed table broke words mid-way
  ".cm-lp-table": { width: "100%", borderCollapse: "collapse", fontSize: "12px", lineHeight: "16px", overflowWrap: "break-word", wordBreak: "normal" },
  ".cm-lp-table th, .cm-lp-table td": {
    padding: "8px 12px 8px 0", verticalAlign: "top", outline: "none", cursor: "text", minWidth: "3em",
    background: "linear-gradient(var(--fg), var(--fg)) bottom / 100% .5px no-repeat",
  },
  ".cm-lp-table th": {
    background: "linear-gradient(var(--fg), var(--fg)) top / 100% .5px no-repeat, linear-gradient(var(--fg), var(--fg)) bottom / 100% .5px no-repeat",
    backgroundColor: "var(--bg)", position: "relative", zIndex: "2",
  },
  // No :is() in these selectors: the theme splits selectors at commas, inside :is() too (the last column's padding
  // rule was dropped that way).
  ".cm-lp-table th:last-child, .cm-lp-table td:last-child": { paddingRight: "0" },
  // Pinned while the table scrolls: the first column sideways (only in a table wider than its column), the header row
  // down the doc.
  ".cm-lp-wide th:first-child, .cm-lp-wide td:first-child": { position: "sticky", left: "0", zIndex: "1" },
  ".cm-lp-wide th:first-child": { zIndex: "3" },
  ".cm-lp-scrolled td:first-child": { backgroundColor: "var(--bg)" }, // opaque only then: a selection behind shows
  // The header row can't be CSS sticky: the wrap scrolls sideways, which makes it the header's scroll container on
  // both axes, so `top` sticks inside the wrap (per-axis scroll containers, `overflow: auto clip`, are Chrome 154+). A
  // script moving it on each scroll trailed the scroll by a frame or more. Instead the header rides a scroll timeline:
  // the wrap's view timeline in the doc's scroller, over the stretch where the table's top has passed the view's top
  // and its last row hasn't (exit-crossing, offset by the wrap's 20px padding), slides it down by that stretch
  // (--travel: the table's height less the header's, set when the table resizes). The browser runs it with the
  // scroll, off the main thread. Firefox (no scroll timelines yet) keeps a header that scrolls away.
  "@keyframes rl-table-head": { from: { transform: "none" }, to: { transform: "translateY(var(--travel))" } },
  "@supports (animation-timeline: view())": {
    ".cm-lp-tablewrap": { viewTimeline: "--rl-table block" },
    ".cm-lp-table th": {
      animation: "rl-table-head linear both",
      animationTimeline: "--rl-table",
      animationRange: "exit-crossing 20px exit-crossing calc(20px + var(--travel, 0px))",
    },
  },
  ".cm-lp-table th:focus, .cm-lp-table td:focus": { boxShadow: "inset 0 0 0 2px rgba(35,131,226,.6)", whiteSpace: "pre-wrap" },
  ".cm-lp-table code": { font: "inherit", color: "inherit", background: "var(--code-bg)", borderRadius: "4px", padding: "0 2px" },
  ".cm-lp-menu": {
    position: "fixed", zIndex: "50", display: "flex", flexDirection: "column", padding: "4px", minWidth: "180px", background: "var(--card)", borderRadius: "6px",
    boxShadow: "var(--pop)",
  },
  ".cm-lp-menu button": { font: "12px var(--sans)", textAlign: "left", border: "0", background: "none", padding: "6px 10px", borderRadius: "4px", cursor: "pointer", color: "var(--fg)" },
  ".cm-lp-menu button:hover:not(:disabled)": { background: "var(--hover)" },
  ".cm-lp-menu button:disabled": { color: "var(--mark)", cursor: "default" },
});
