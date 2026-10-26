// ```mermaid blocks render as diagrams. Renderer: beautiful-mermaid (ELK layout, no DOM), loaded on first use:
// 470 KB gzipped, 20-70 ms a diagram, against mermaid.js's ~1.5 MB and a DOM render. (@vercel/beautiful-mermaid,
// 45 KB and ~5 ms, was tried first: it kept the quotes of `A["label"]`, ignored `<br/>` and drew back edges
// outside the picture.) The source always shows, like any code block; the diagram renders under it and follows
// edits live.
import { syntaxTree } from "@codemirror/language";
import { StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import type * as Mermaid from "beautiful-mermaid";

let lib: Promise<typeof Mermaid> | undefined;
// Every colour in the SVG derives from --bg/--fg. As an <img> it can't see the page's variables, but it does
// follow the system colour scheme in its own media query.
const light = { bg: "#ffffff", fg: "#37352f" };
const dark = `<style>@media (prefers-color-scheme: dark) { svg { --bg: #191919 !important; --fg: #d4d4d4 !important } }</style>`;
const cache = new Map<string, Promise<string>>(); // source -> SVG, so redrawing the editor doesn't re-render

function svgOf(src: string) {
  let svg = cache.get(src);
  if (!svg) {
    svg = (lib ??= import("beautiful-mermaid"))
      .then((m) => m.renderMermaidSVG(src, { ...light, transparent: true, padding: 16 }))
      .then((s) => s.replace(/(<svg[^>]*>)/, `$1${dark}`));
    cache.set(src, svg);
    if (cache.size > 50) cache.delete(cache.keys().next().value!);
  }
  return svg;
}

class MermaidWidget extends WidgetType {
  constructor(readonly src: string) { super(); }
  eq(o: MermaidWidget) { return o.src === this.src; }
  toDOM(view: EditorView) {
    const box = document.createElement("div");
    box.className = "cm-lp-mermaid";
    this.updateDOM(box, view);
    return box;
  }
  // Typing in the source keeps the last picture until the new one has loaded, so the text below doesn't jump. A
  // source that doesn't parse (half-typed) fades the last picture; with none yet, the error shows instead.
  updateDOM(box: HTMLElement, view: EditorView) {
    const src = (box.dataset.src = this.src);
    const fresh = () => box.dataset.src === src; // a newer source may be rendering meanwhile
    svgOf(src).then(
      (svg) => {
        if (!fresh()) return;
        const w = Number(/width="([\d.]+)"/.exec(svg)?.[1] ?? 0);
        const img = document.createElement("img");
        // fit the column, but never below 70%: a wider diagram scrolls
        img.style.width = `max(min(100%, ${w}px), ${w * 0.7}px)`;
        img.alt = "diagram";
        img.onload = () => {
          if (!fresh()) return;
          box.className = "cm-lp-mermaid";
          box.title = "";
          box.replaceChildren(img);
          view.requestMeasure();
        };
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      },
      (e) => {
        if (!fresh()) return;
        const msg = `Diagram: ${e instanceof Error ? e.message : e}`;
        if (box.querySelector("img")) {
          box.className = "cm-lp-mermaid cm-lp-mermaid-stale";
          box.title = msg;
        } else {
          box.className = "cm-lp-mermaid cm-lp-mermaid-err";
          box.textContent = msg;
        }
        view.requestMeasure();
      },
    );
    return true;
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
      out.push(Decoration.widget({ widget: new MermaidWidget(src), block: true, side: 1 }).range(last.to));
      return false;
    },
  });
  return Decoration.set(out);
}

// Block widgets can't come from a view plugin. Walks only top-level blocks: fences inside lists/quotes stay code.
export const mermaidField = StateField.define<DecorationSet>({
  create: diagrams,
  update: (deco, tr) => (tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState) ? diagrams(tr.state) : deco),
  provide: (f) => EditorView.decorations.from(f),
});

export const mermaidTheme = EditorView.theme({
  ".cm-lp-mermaid": { overflowX: "auto", marginTop: "8px", marginBottom: "8px", textAlign: "center" },
  ".cm-lp-mermaid img": { display: "inline-block", verticalAlign: "top" },
  ".cm-lp-mermaid-err": { color: "var(--faint)", fontSize: "13px", textAlign: "left", cursor: "text" },
  ".cm-lp-mermaid-stale": { opacity: "0.4" },
});
