// Inline comments (comments/inline.ts) in the editor. Their markers and thread blocks are hidden and atomic; typing at
// a commented range's edge stays outside it (and at the end of the doc, above the thread blocks); deleting next to
// hidden markup deletes the visible character, never the markup; copying leaves the markup out (a pasted copy would
// repeat thread ids).
import { syntaxTree } from "@codemirror/language";
import { EditorState, StateField, Transaction, findClusterBreak, type Range } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { hidden, plain } from "../comments/inline.ts";

// Markers in fenced code would be code (inline.ts skips them), so text there can't take a comment.
export function inCode(state: EditorState, pos: number): boolean {
  for (let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent)
    if (n.name === "FencedCode" || n.name === "CodeBlock") return true;
  return false;
}

type Span = { from: number; to: number };

// ponytail: reparses the whole doc on every change; fine at doc sizes, go incremental if typing in huge docs lags
function build(state: EditorState): { spans: Span[]; deco: DecorationSet } {
  const doc = state.doc;
  const text = doc.toString();
  const spans = hidden(text);
  const deco: Range<Decoration>[] = spans.map((s) => {
    if (text.charAt(s.to - 1) !== "\n") return Decoration.replace({}).range(s.from, s.to); // a marker
    // a thread block: whole lines, and the empty last line when it ends the doc
    return Decoration.replace({ block: true }).range(s.from, s.to === doc.length ? s.to : s.to - 1);
  });
  return { spans, deco: Decoration.set(deco, true) };
}

const field = StateField.define({
  create: build,
  update: (v, tr) => (tr.docChanged ? build(tr.state) : v),
  provide: (f) => [EditorView.decorations.from(f, (v) => v.deco), EditorView.atomicRanges.of((view) => view.state.field(f).deco)],
});

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
