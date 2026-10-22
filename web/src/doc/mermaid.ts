// ```mermaid blocks render as diagrams. Renderer: @vercel/beautiful-mermaid (dagre layout, no DOM), loaded on first
// use: ~45 KB gzipped and ~5 ms a diagram, against mermaid.js's ~1.5 MB and a DOM render (beautiful-mermaid with
// ELK: 470 KB, ~24 ms). The diagram replaces the block; with the selection in the block, the source shows and the
// diagram follows it live underneath.
import { syntaxTree } from "@codemirror/language";
import { StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import type * as Mermaid from "@vercel/beautiful-mermaid";

let lib: Promise<typeof Mermaid> | undefined;
// Every colour in the SVG derives from --bg/--fg. As an <img> it can't see the page's variables, but it does
// follow the system colour scheme in its own media query.
const light = { bg: "#ffffff", fg: "#37352f" };
const dark = `<style>@media (prefers-color-scheme: dark) { svg { --bg: #191919 !important; --fg: #d4d4d4 !important } }</style>`;
const cache = new Map<string, Promise<string>>(); // source -> SVG, so the source showing/hiding doesn't re-render

function svgOf(src: string) {
  let svg = cache.get(src);
  if (!svg) {
    svg = (lib ??= import("@vercel/beautiful-mermaid"))
      // this renderer has no multi-line labels: "<br/>" would show literally
      .then((m) => m.renderMermaid(src.replace(/<br\s*\/?>/gi, " "), { ...light, transparent: true, padding: 16 }))
      .then((s) => s.replace(/(<svg[^>]*>)/, `$1${dark}`));
    cache.set(src, svg);
    if (cache.size > 50) cache.delete(cache.keys().next().value!);
  }
  return svg;
}

class MermaidWidget extends WidgetType {
  constructor(readonly src: string, readonly hidden: boolean) { super(); }
  eq(o: MermaidWidget) { return o.src === this.src && o.hidden === this.hidden; }
  toDOM(view: EditorView) {
    const box = document.createElement("div");
    box.className = "cm-lp-mermaid cm-lp-wide";
    svgOf(this.src).then(
      (svg) => {
        const w = Number(/width="([\d.]+)"/.exec(svg)?.[1] ?? 0);
        const img = box.appendChild(document.createElement("img"));
        // fit the column, but never below 70%: a wider diagram scrolls
        img.style.width = `max(min(100%, ${w}px), ${w * 0.7}px)`;
        img.alt = "diagram";
        img.onload = () => view.requestMeasure();
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      },
      (e) => {
        box.classList.add("cm-lp-mermaid-err");
        box.textContent = `Diagram: ${e instanceof Error ? e.message : e}`;
        view.requestMeasure();
      },
    );
    if (this.hidden)
      box.addEventListener("mousedown", (e) => {
        e.preventDefault(); // click the diagram to edit its source
        const at = view.state.doc.lineAt(view.posAtDOM(box));
        view.dispatch({ selection: { anchor: Math.min(at.to + 1, view.state.doc.length) } });
        view.focus();
      });
    return box;
  }
  ignoreEvent() { return true; }
}

function diagrams(state: EditorState): DecorationSet {
  const doc = state.doc;
  const out: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (n) => {
      if (n.name === "Document") return;
      if (n.name !== "FencedCode") return false;
      const info = n.node.getChild("CodeInfo");
      const close = n.node.lastChild;
      if (!info || doc.sliceString(info.from, info.to).trim().toLowerCase() !== "mermaid") return false;
      const first = doc.lineAt(n.from), last = doc.lineAt(n.to);
      if (close?.name !== "CodeMark" || doc.lineAt(close.from).number === first.number) return false; // still being typed
      const src = doc.sliceString(first.to + 1, last.from - 1);
      const editing = state.selection.ranges.some((r) => r.from <= last.to && r.to >= first.from);
      out.push(
        editing
          ? Decoration.widget({ widget: new MermaidWidget(src, false), block: true, side: 1 }).range(last.to)
          : Decoration.replace({ widget: new MermaidWidget(src, true), block: true }).range(first.from, last.to),
      );
      return false;
    },
  });
  return Decoration.set(out);
}

// Block widgets can't come from a view plugin. Walks only top-level blocks: fences inside lists/quotes stay code.
export const mermaidField = StateField.define<DecorationSet>({
  create: diagrams,
  update: (deco, tr) => (tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState) ? diagrams(tr.state) : deco),
  provide: (f) => EditorView.decorations.from(f),
});

export const mermaidTheme = EditorView.theme({
  ".cm-lp-mermaid": { overflowX: "auto", marginTop: "8px", marginBottom: "8px", textAlign: "center", cursor: "pointer" },
  ".cm-lp-mermaid img": { display: "inline-block", verticalAlign: "top" },
  ".cm-lp-mermaid-err": { color: "var(--faint)", fontSize: "13px", textAlign: "left", cursor: "text" },
});
