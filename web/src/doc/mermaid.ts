// ```mermaid blocks render as diagrams. Renderer: beautiful-mermaid (ELK layout, no DOM), in a worker loaded on first
// use (mermaid.worker.ts): 470 KB gzipped, 20-70 ms a diagram, against mermaid.js's ~1.5 MB and a DOM render.
// (@vercel/beautiful-mermaid, 45 KB and ~5 ms, was tried first: it kept the quotes of `A["label"]`, ignored `<br/>`
// and drew back edges outside the picture.) The source always shows, like any code block; the diagram renders under
// it and follows edits live.
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { blockField } from "./blocks.ts";
import type { Reply, Request } from "./mermaid.worker.ts";

declare const MERMAID_WORKER: string; // the worker's URL, injected by build.ts
let worker: Worker | undefined;
let nextId = 0;
const waiting = new Map<number, PromiseWithResolvers<string>>();
// Every colour in the SVG derives from --bg/--fg. As an <img> it can't see the page's variables, but it does
// follow the system colour scheme in its own media query.
const light = { bg: "#ffffff", fg: "#37352f" };
const dark = `<style>@media (prefers-color-scheme: dark) { svg { --bg: #191919 !important; --fg: #d4d4d4 !important } }</style>`;
// source -> SVG, so redrawing the editor doesn't re-render (a diagram scrolled back to shows at its size at once)
// ponytail: 200 SVGs of ~20 KB at most; key by doc if docs ever hold more diagrams than that
const cache = new Map<string, Promise<string>>();

function render(src: string): Promise<string> {
  if (!worker) {
    worker = new Worker(MERMAID_WORKER, { type: "module" });
    worker.onmessage = (e: MessageEvent<Reply>) => {
      const r = e.data, w = waiting.get(r.id)!;
      waiting.delete(r.id);
      if ("svg" in r) w.resolve(r.svg);
      else w.reject(new Error(r.error));
    };
  }
  const id = nextId++, w = Promise.withResolvers<string>();
  waiting.set(id, w);
  worker.postMessage({ id, src, options: { ...light, transparent: true, padding: 16 } } satisfies Request);
  return w.promise;
}

function svgOf(src: string) {
  let svg = cache.get(src);
  if (!svg) {
    svg = render(src).then((s) => s.replace(/(<svg[^>]*>)/, `$1${dark}`));
    cache.set(src, svg);
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
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

// Block widgets can't come from a view plugin, so diagrams live in a state field (blocks.ts: a change rescans only
// the blocks it touched). Only top-level fences: ones inside lists/quotes stay code.
export const mermaidField = blockField((state, n, out) => {
  const doc = state.doc;
  if (n.name !== "FencedCode") return;
  const info = n.getChild("CodeInfo");
  const close = n.lastChild;
  if (!info || doc.sliceString(info.from, info.to).trim().toLowerCase() !== "mermaid") return;
  const first = doc.lineAt(n.from), last = doc.lineAt(n.to);
  if (close?.name !== "CodeMark" || doc.lineAt(close.from).number === first.number) return; // still being typed
  const src = doc.sliceString(first.to + 1, last.from - 1);
  out.push(Decoration.widget({ widget: new MermaidWidget(src), block: true, side: 1 }).range(last.to));
});

export const mermaidTheme = EditorView.theme({
  // padding, not margin: CodeMirror can't see a block widget's margins, and clicks below it would land too low
  ".cm-lp-mermaid": { overflowX: "auto", paddingTop: "8px", paddingBottom: "8px", textAlign: "center" },
  ".cm-lp-mermaid img": { display: "inline-block", verticalAlign: "top" },
  ".cm-lp-mermaid-err": { color: "var(--faint)", fontSize: "13px", textAlign: "left", cursor: "text" },
  ".cm-lp-mermaid-stale": { opacity: "0.4" },
});
