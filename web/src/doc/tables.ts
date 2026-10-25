// GFM tables, Obsidian-style: always rendered as a table whose cells are edited in place. The focused cell shows
// its raw markdown; Tab / Shift-Tab / Enter move between cells (adding a row past the end), arrows and Escape
// leave the table, right-click inserts or deletes rows and columns.
// Editing a cell rewrites only that cell's text in the file (agents' diffs stay one cell wide); column changes
// rewrite every row of the table.
import { syntaxTree } from "@codemirror/language";
import { StateEffect, StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, runScopeHandlers, type DecorationSet } from "@codemirror/view";

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
// Cell text -> HTML: code spans, bold, italic, link text. Everything from the doc is escaped first.
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

// After a change that redraws the table (new row, new column), the cell to put the caret back in.
let refocus: { r: number; c: number; end: boolean } | null = null;
const raws = new WeakMap<HTMLElement, string[][]>(); // the table element -> current raw cell texts
// The cell being edited and its table's start. When a redraw removes that cell, Chrome drops the focus to
// nowhere (lostAt); the redrawn table takes it back if that happened just now. Focus moved by the user clears it.
let editing: { from: number; r: number; c: number; lostAt: number } | null = null;

class TableWidget extends WidgetType {
  readonly cells: string[][]; // raw text per source row (delimiter row included)
  readonly align: string[];
  constructor(readonly src: string) {
    super();
    let at = 0;
    this.cells = src.split("\n").map((line) => {
      const row = splitRow(line, at).map((c) => unescape(src.slice(c.from, c.to)));
      at += line.length + 1;
      return row;
    });
    this.align = (this.cells[1] ?? []).map((d) => (d.endsWith(":") ? (d.startsWith(":") ? "center" : "right") : "left"));
  }
  get width() {
    return this.cells[0]?.length ?? 0;
  }
  eq(o: TableWidget) {
    return o.src === this.src;
  }
  // Same rows and columns: patch the cells in place, so the cell being typed in keeps its caret.
  updateDOM(dom: HTMLElement, view: EditorView) {
    const old = raws.get(dom);
    if (!old || old.length !== this.cells.length || old[0]?.length !== this.width || refocus) {
      // rows or columns changed (undo, a peer, an agent): the redrawn table gets the caret back
      const at = cellOf(document.activeElement);
      if (!refocus && at && dom.contains(at)) refocus = { r: Number(at.dataset.r), c: Number(at.dataset.c), end: true };
      return false;
    }
    for (const el of dom.querySelectorAll<HTMLElement>("[data-r]")) {
      const raw = this.raw(Number(el.dataset.r), Number(el.dataset.c));
      if (el !== document.activeElement) el.innerHTML = cellHtml(raw);
      // The file trims cells, so a space just typed at an end isn't stored yet: compare what would be stored.
      else if (unescape(toCell(el.textContent ?? "")).trim() !== raw) {
        el.textContent = raw; // undo or a remote edit changed the cell being edited
        caretEnd(el);
      }
      el.contentEditable = view.state.readOnly ? "false" : "true";
    }
    raws.set(dom, this.cells);
    return true;
  }
  raw(r: number, c: number) {
    return this.cells[r]?.[c] ?? "";
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-lp-tablewrap cm-lp-wide";
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
        el.innerHTML = cellHtml(this.raw(r, c));
      }
    });
    raws.set(wrap, this.cells);
    wire(wrap, view);
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
  // The focused cell shows its raw text, with "\|" shown as "|": count source characters up to a shown offset.
  const src = view.state.doc.sliceString(cell.from, cell.to);
  const pos = (container: Node, offset: number) => {
    const before = document.createRange();
    before.selectNodeContents(el);
    before.setEnd(container, offset);
    let i = 0;
    for (let n = before.toString().length; n > 0 && i < src.length; n--) i += src.startsWith("\\|", i) ? 2 : 1;
    return cell.from + i;
  };
  const from = pos(range.startContainer, range.startOffset), to = pos(range.endContainer, range.endOffset);
  return from < to ? { from, to } : null;
}

const cellSelectionSync = ViewPlugin.define((view) => {
  const sync = () => {
    const next = selectedInCell(view), cur = view.state.field(cellSelection);
    if (next?.from !== cur?.from || next?.to !== cur?.to) view.dispatch({ effects: setCellSelection.of(next) });
  };
  document.addEventListener("selectionchange", sync);
  return { destroy: () => document.removeEventListener("selectionchange", sync) };
});
export const cellComments = [cellSelection, cellSelectionSync];

function wire(wrap: HTMLElement, view: EditorView) {
  const tableNow = () => tableAt(view.state, view.posAtDOM(wrap));
  const rowsShown = () => (raws.get(wrap) ?? []).map((_, r) => r).filter((r) => r !== 1);

  wrap.addEventListener("focusin", (e) => {
    const el = cellOf(e.target);
    if (!el) return;
    editing = { from: view.posAtDOM(wrap), r: Number(el.dataset.r), c: Number(el.dataset.c), lostAt: -Infinity };
    el.textContent = raws.get(wrap)?.[Number(el.dataset.r)]?.[Number(el.dataset.c)] ?? "";
  });
  wrap.addEventListener("focusout", (e) => {
    const el = cellOf(e.target);
    if (el) el.innerHTML = cellHtml(raws.get(wrap)?.[Number(el.dataset.r)]?.[Number(el.dataset.c)] ?? "");
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
    const t = tableNow();
    if (!el || !t) return;
    const r = Number(el.dataset.r), c = Number(el.dataset.c);
    const row = t.rows[r];
    if (!row) return;
    const text = toCell(el.textContent ?? "");
    const cell = row.cells[c];
    if (cell) {
      // Only the changed span: keystrokes become plain inserts, so undo groups them like normal typing and a
      // peer typing elsewhere in the same cell isn't overwritten. One space of padding is kept when the cell had
      // some, so typed spaces don't pile up at the end.
      const old = view.state.doc.sliceString(cell.from, cell.end);
      const next = text.trimEnd() + (cell.end > cell.to ? " " : "");
      let p = 0;
      while (p < old.length && p < next.length && old[p] === next[p]) p++;
      let s = 0;
      while (s < old.length - p && s < next.length - p && old[old.length - 1 - s] === next[next.length - 1 - s]) s++;
      if (p === old.length && p === next.length) return;
      view.dispatch({ changes: { from: cell.from + p, to: cell.end - s, insert: next.slice(p, next.length - s) }, userEvent: "input.type" });
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
    // Undo/redo/save are the editor's (one history with the rest of the doc), not the cell's native undo.
    if ((e.ctrlKey || e.metaKey) && /^[zys]$/i.test(e.key)) {
      e.preventDefault();
      runScopeHandlers(view, e, "editor");
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

function menu(view: EditorView, t: Table, r: number, c: number, x: number, y: number) {
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
  const close = () => {
    box.remove();
    removeEventListener("mousedown", outside, true);
    removeEventListener("keydown", onKey, true);
  };
  const outside = (e: MouseEvent) => !box.contains(e.target as Node) && close();
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
  for (const [label, enabled, run] of items) {
    const b = box.appendChild(document.createElement("button"));
    b.textContent = label;
    b.disabled = !enabled;
    b.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the cell
    b.addEventListener("click", () => {
      close();
      run();
    });
  }
  view.dom.appendChild(box);
  addEventListener("mousedown", outside, true);
  addEventListener("keydown", onKey, true);
}

function tables(state: EditorState): DecorationSet {
  const doc = state.doc;
  const out: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (n) => {
      if (n.name === "Paragraph" || n.name === "FencedCode" || n.name.includes("Heading")) return false; // no tables inside
      if (n.name !== "Table") return;
      const first = doc.lineAt(n.from), last = doc.lineAt(n.to);
      out.push(Decoration.replace({ widget: new TableWidget(doc.sliceString(first.from, last.to)), block: true }).range(first.from, last.to));
      return false;
    },
  });
  return Decoration.set(out, true);
}

// Block widgets can't come from a view plugin, so tables live in a state field.
// ponytail: rebuilt on every doc change by walking the block tree; fine for docs of a few thousand lines.
export const tableField = StateField.define<DecorationSet>({
  create: tables,
  update: (deco, tr) => (tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState) ? tables(tr.state) : deco),
  provide: (f) => EditorView.decorations.from(f),
});

export const tableTheme = EditorView.theme({
  // A spacer as wide as the breakout keeps a table that fits the text column aligned with the text; a wider one
  // eats into it and grows into the margins (.cm-lp-wide), then wraps its cells, then scrolls.
  ".cm-lp-tablewrap": { display: "flex", overflowX: "auto", marginTop: "6px", marginBottom: "6px" },
  ".cm-lp-tablewrap::before": { content: '""', flex: "0 1 var(--out)" },
  // CodeMirror's wrapping (overflow-wrap: anywhere, word-break: break-word) makes every column's minimum one
  // letter, so a squeezed table broke words mid-way
  ".cm-lp-table": {
    flex: "none", maxWidth: "100%", borderCollapse: "collapse", fontSize: "12px", lineHeight: "1.5", overflowWrap: "break-word", wordBreak: "normal",
    minWidth: "calc((100% - 2 * var(--out)) * .6)",
  },
  ".cm-lp-table th, .cm-lp-table td": { border: "1px solid var(--rule)", padding: "6px 10px", verticalAlign: "top", outline: "none", cursor: "text", minWidth: "3em" },
  ".cm-lp-table th": { background: "var(--bg2)", fontWeight: "600" },
  ".cm-lp-table th:focus, .cm-lp-table td:focus": { boxShadow: "inset 0 0 0 2px rgba(35,131,226,.6)", whiteSpace: "pre-wrap" },
  ".cm-lp-table code": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: "85%", color: "var(--code)",
    background: "var(--code-bg)", borderRadius: "4px", padding: "0.1em 0.3em",
  },
  ".cm-lp-menu": {
    position: "fixed", zIndex: "50", display: "flex", flexDirection: "column", padding: "4px", minWidth: "180px", background: "var(--card)", borderRadius: "6px",
    boxShadow: "var(--pop)",
  },
  ".cm-lp-menu button": { font: "12px var(--sans)", textAlign: "left", border: "0", background: "none", padding: "6px 10px", borderRadius: "4px", cursor: "pointer", color: "var(--fg)" },
  ".cm-lp-menu button:hover:not(:disabled)": { background: "var(--hover)" },
  ".cm-lp-menu button:disabled": { color: "var(--mark)", cursor: "default" },
});
