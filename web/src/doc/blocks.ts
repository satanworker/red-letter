// Block widgets (tables, images, diagrams) live in state fields, since block decorations can't come from a view
// plugin. Rebuilding them on every change meant walking the whole syntax tree per keystroke: a cost that grew with the
// doc (25 ms a key at 17k lines). Instead each field keeps its decorations and, after a change, rescans only the
// top-level blocks the new tree doesn't share with the old one: blocks an edit touched, and blocks the parser has
// reached or redrawn since. Every other decoration is mapped through the change, keeping its widget (and DOM).
// Which blocks those are is worked out once per change (`blockChanges`), for every field.
// ponytail: that walks every top-level block once per change (about 1 ms at 17k lines); past that, skip the subtrees
// the parser reused (same Tree object) instead of comparing each block's position.
import { syntaxTree } from "@codemirror/language";
import { StateField, type EditorState, type Range, type Transaction } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { SyntaxNode, Tree } from "@lezer/common";

// tops: the tree's top-level blocks as [from, to, type] triples, in order. fresh: blocks to rescan (all of them when
// the field was created). gone: ranges whose decorations go, disjoint and in order: what the change wrote, and the
// lines of every fresh block.
type Changes = { tree: Tree; tops: number[]; fresh: SyntaxNode[]; gone: [number, number][] };

const blockChanges = StateField.define<Changes>({
  create(state) {
    const tree = syntaxTree(state), tops: number[] = [], fresh: SyntaxNode[] = [];
    const c = tree.cursor();
    if (c.firstChild()) do tops.push(c.from, c.to, c.type.id), fresh.push(c.node); while (c.nextSibling());
    return { tree, tops, fresh, gone: [] };
  },
  update(v, tr) {
    const tree = syntaxTree(tr.state);
    if (tree === v.tree && !tr.docChanged) return v;
    const { changes } = tr;
    const old = tr.startState.doc, doc = tr.state.doc;
    // the old blocks no change touched (on any of their lines: decorations sit on them), at their new positions
    const lines: [number, number][] = [];
    changes.iterChangedRanges((fromA, toA) => lines.push([old.lineAt(fromA).from, old.lineAt(toA).to]));
    const kept: number[] = [];
    for (let i = 0; i < v.tops.length; i += 3) {
      const from = v.tops[i]!, to = v.tops[i + 1]!;
      if (!lines.some(([a, b]) => a <= to && b >= from)) kept.push(changes.mapPos(from), changes.mapPos(to), v.tops[i + 2]!);
    }
    const dirty: [number, number][] = [];
    changes.iterChangedRanges((_fa, _ta, from, to) => dirty.push([from, to]));
    const tops: number[] = [], fresh: SyntaxNode[] = [];
    const c = tree.cursor();
    let k = 0;
    if (c.firstChild())
      do {
        tops.push(c.from, c.to, c.type.id);
        while (k < kept.length && kept[k]! < c.from) k += 3;
        if (kept[k] === c.from && kept[k + 1] === c.to && kept[k + 2] === c.type.id) continue;
        fresh.push(c.node);
        dirty.push([doc.lineAt(c.from).from, doc.lineAt(c.to).to]);
      } while (c.nextSibling());
    const gone: [number, number][] = [];
    for (const r of dirty.sort((a, b) => a[0] - b[0])) {
      const last = gone.at(-1);
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else gone.push(r);
    }
    return { tree, tops, fresh, gone };
  },
});

// Decorations for one top-level block, each on the lines the block spans (a table's starts at its line, before any
// indentation the block leaves out).
type Scan = (state: EditorState, block: SyntaxNode, out: Range<Decoration>[]) => void;
type Value = { deco: DecorationSet; tree: Tree };

// rebuild: transactions after which every block is rescanned (a setting the widgets depend on changed)
export function blockField(scan: Scan, rebuild: (tr: Transaction) => boolean = () => false) {
  const all = (state: EditorState): Value => {
    const tree = syntaxTree(state), out: Range<Decoration>[] = [];
    const c = tree.cursor();
    if (c.firstChild()) do scan(state, c.node, out); while (c.nextSibling());
    return { deco: Decoration.set(out, true), tree };
  };
  const field = StateField.define<Value>({
    create: all,
    update(v, tr) {
      if (rebuild(tr)) return all(tr.state);
      const { tree, fresh, gone } = tr.state.field(blockChanges);
      if (tree === v.tree && !tr.docChanged) return v;
      if (!gone.length) return { deco: v.deco, tree };
      const out: Range<Decoration>[] = [];
      for (const block of fresh) scan(tr.state, block, out);
      const deco = v.deco.map(tr.changes).update({
        add: out,
        sort: true,
        filterFrom: gone[0]![0],
        filterTo: gone.at(-1)![1],
        // binary search: the filter visits overlapping decorations' layers one by one, so not in a single pass
        filter: (from, to) => {
          let lo = 0, hi = gone.length; // the first range ending at or after `from`: the only one that can overlap first
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (gone[mid]![1] < from) lo = mid + 1;
            else hi = mid;
          }
          return !(lo < gone.length && gone[lo]![0] <= to);
        },
      });
      return { deco, tree };
    },
    provide: (f) => [EditorView.decorations.from(f, (v) => v.deco), blockChanges],
  });
  return field;
}
