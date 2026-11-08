// Inline comments (comments/inline.ts) in the editor. Their markers and thread blocks are hidden and atomic; typing at
// a commented range's edge stays outside it (and at the end of the doc, above the thread blocks); deleting next to
// hidden markup deletes the visible character, never the markup; copying leaves the markup out (a pasted copy would
// repeat thread ids).
import { syntaxTree } from "@codemirror/language";
import { EditorState, StateField, Transaction, findClusterBreak, type Text } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { parse, plain, threadsOf, type Parsed, type Span, type Thread } from "../comments/inline.ts";

// Markers in fenced code would be code (inline.ts skips them), so text there can't take a comment.
export function inCode(state: EditorState, pos: number): boolean {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent)
    if (n.name === "FencedCode" || n.name === "CodeBlock") return true;
  return false;
}

// parses: how many times the doc was parsed whole, i.e. the markup may have changed other than by moving along
type Value = { parsed: Parsed; spans: Span[]; deco: DecorationSet; parses: number };

function build(doc: Text, parses: number): Value {
  const { blocks, markers } = parse(doc.toString());
  const parsed = { blocks, markers };
  const spans = [...parsed.blocks, ...parsed.markers].sort((a, b) => a.from - b.from);
  const deco = spans.map((s) => {
    if (doc.sliceString(s.to - 1, s.to) !== "\n") return Decoration.replace({}).range(s.from, s.to); // a marker
    // a thread block: whole lines, and the empty last line when it ends the doc
    return Decoration.replace({ block: true }).range(s.from, s.to === doc.length ? s.to : s.to - 1);
  });
  return { parsed, spans, deco: Decoration.set(deco, true), parses };
}

// The first span ending at or after `pos` (spans are sorted and disjoint), or undefined.
function spanFrom(spans: Span[], pos: number): Span | undefined {
  let lo = 0, hi = spans.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid]!.to < pos) lo = mid + 1;
    else hi = mid;
  }
  return spans[lo];
}

const FENCE = /^ {0,3}(```|~~~)/;
// Lines `from`..`to` of `doc` hold no code fence line, and no "<!--" or "-->" outside markup in `spans`.
function plainLines(doc: Text, spans: Span[], from: number, to: number): boolean {
  for (let l = doc.lineAt(from).number, last = doc.lineAt(to).number; l <= last; l++) {
    const { text, from: at } = doc.line(l);
    if (FENCE.test(text)) return false;
    for (const token of ["<!--", "-->"])
      for (let i = text.indexOf(token); i >= 0; i = text.indexOf(token, i + 1)) {
        const span = spanFrom(spans, at + i);
        if (!span || span.from > at + i || span.to < at + i + token.length) return false;
      }
  }
  return true;
}

// Parsing the whole doc on every keystroke cost time in proportion to its length, so a change only moves the markup it
// can't alter. It can alter markup when it touches a marker or block (its edges too), or when its lines, before or
// after, hold a code fence (markup in fences doesn't count) or a "<!--" or "-->" that isn't markup (one the change
// makes, or one a match of the whole doc may end on): then the doc is parsed again. Tokens never span lines, so the
// changed lines are all there is to look at.
function moved(v: Value, tr: Transaction): Value | null {
  const { changes } = tr;
  const map = <T extends Span>(s: T): T => ({ ...s, from: changes.mapPos(s.from), to: changes.mapPos(s.to) });
  const blocks = v.parsed.blocks.map((b) => ({ ...map(b), close: changes.mapPos(b.close) }));
  const markers = v.parsed.markers.map(map);
  const spans = [...blocks, ...markers].sort((a, b) => a.from - b.from);
  let ok = true;
  changes.iterChanges((fromA, toA, fromB, toB) => {
    const s = ok && spanFrom(v.spans, fromA);
    ok &&= !(s && s.from <= toA) && plainLines(tr.startState.doc, v.spans, fromA, toA) && plainLines(tr.state.doc, spans, fromB, toB);
  });
  return ok ? { parsed: { blocks, markers }, spans, deco: v.deco.map(changes), parses: v.parses } : null;
}

const field = StateField.define<Value>({
  create: (state) => build(state.doc, 0),
  update: (v, tr) => (tr.docChanged ? (moved(v, tr) ?? build(tr.state.doc, v.parses + 1)) : v),
  provide: (f) => [EditorView.decorations.from(f, (v) => v.deco), EditorView.atomicRanges.of((view) => view.state.field(f).deco)],
});

// The comment markup as the editor holds it, and its threads (comments/inline.ts parse, kept up to date through edits).
export const commentSpans = (state: EditorState): Parsed => state.field(field).parsed;
export const commentParses = (state: EditorState): number => state.field(field).parses;
const threadsIn = new WeakMap<Value, Thread[]>();
export function commentThreads(state: EditorState): Thread[] {
  const v = state.field(field);
  let t = threadsIn.get(v);
  if (!t) threadsIn.set(v, (t = threadsOf(v.parsed, (from, to) => state.doc.sliceString(from, to))));
  return t;
}

const guard = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !(tr.isUserEvent("input") || tr.isUserEvent("delete"))) return tr;
  const { spans } = tr.startState.field(field);
  if (!spans.length) return tr;
  const doc = tr.startState.doc;
  let n = 0, a = 0, b = 0, ins = "";
  tr.changes.iterChanges((fa, ta, _fb, _tb, inserted) => {
    n++;
    a = fa;
    b = ta;
    ins = inserted.toString();
  });
  if (n !== 1) return tr; // several cursors: CodeMirror's own handling
  const userEvent = tr.annotation(Transaction.userEvent);
  const closing = (s: Span) => doc.sliceString(s.from, s.from + 5) === "<!--/";

  if (a === b) {
    let p = a;
    for (let s; (s = spans.find((x) => x.from === p && closing(x))); ) p = s.to;
    if (p === a) for (let s; (s = spans.find((x) => x.to === p && !closing(x))); ) p = s.from;
    return p === a ? tr : { changes: { from: p, insert: ins }, selection: { anchor: p + ins.length }, userEvent, scrollIntoView: true };
  }

  const inside = spans.filter((s) => s.from < b && s.to > a);
  if (!inside.length) return tr;
  const pieces: Span[] = [];
  let at = a;
  for (const s of inside) {
    if (s.from > at) pieces.push({ from: at, to: s.from });
    at = Math.max(at, s.to);
  }
  if (at < b) pieces.push({ from: at, to: b });
  if (!pieces.length) {
    if (ins) return tr;
    // only markup (Backspace / Delete take an atomic range whole): the visible character beyond it instead
    const back = tr.isUserEvent("delete.backward");
    let p = back ? a : b;
    for (let s; (s = spans.find((x) => (back ? x.to === p : x.from === p))); ) p = back ? s.from : s.to;
    if (back ? p === 0 : p === doc.length) return {};
    const line = doc.lineAt(p);
    if (back) pieces.push({ from: p === line.from ? p - 1 : line.from + findClusterBreak(line.text, p - line.from, false), to: p });
    else pieces.push({ from: p, to: p === line.to ? p + 1 : line.from + findClusterBreak(line.text, p - line.from, true) });
  }
  const changes = pieces.map((s, i) => ({ ...s, insert: i ? "" : ins }));
  return ins ? { changes, selection: { anchor: pieces[0]!.from + ins.length }, userEvent, scrollIntoView: true } : { changes, userEvent, scrollIntoView: true };
});

export const commentMarks = [field, guard, EditorView.clipboardOutputFilter.of((text) => plain(text).text)];
