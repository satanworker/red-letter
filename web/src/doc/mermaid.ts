// ```mermaid blocks render as diagrams. Renderer: Obsidian's pele (its own layout, no DOM, synchronous), each diagram
// type's code loaded on first use (pele/lazy): 0.05–0.3 ms a diagram, so no worker and no cache. (beautiful-mermaid
// before it took 20–70 ms on ELK in a 470 KB-gzipped worker; @vercel/beautiful-mermaid kept the quotes of
// `A["label"]`.) The source always shows, like any code block; the diagram renders under it and follows edits live.
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { blockField } from "./blocks.ts";

// The SVG shows as an <img> (a repo's diagrams are untrusted; an image runs nothing), which can't see the page's
// variables but follows the system colour scheme in its own media query. Colours from app.css.
const theme = `<style>.pele { --pele-bg: #fff; --pele-fg: #373737; --pele-line: #373737; --pele-muted: #adadad }
@media (prefers-color-scheme: dark) { .pele { --pele-bg: #191919; --pele-fg: #dbdbdb; --pele-line: #dbdbdb; --pele-muted: #8c8c8c;
--pele-surface: #2a2a2a; --pele-surface-alt: #252525; --pele-border: #555 } }</style>`;

async function svgOf(src: string) {
  // dynamic: pele stays out of the main bundle until a doc has a diagram (as highlight.ts does for @pierre/highlights)
  const { renderAsync } = await import("pele/lazy");
  // responsive: false keeps the natural size in width/height, which the <img> needs
  const r = await renderAsync(src, { responsive: false, padding: 16 });
  return { w: r.width, svg: r.svg.replace(/(<svg[^>]*>)/, `$1${theme}`) };
}

// Drawn heights by source: CodeMirror counts an undrawn widget as one line unless told (see images.ts)
const heights = new Map<string, number>();

class MermaidWidget extends WidgetType {
  constructor(readonly src: string) { super(); }
  eq(o: MermaidWidget) { return o.src === this.src; }
  get estimatedHeight() { return heights.get(this.src) ?? -1; }
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
      ({ w, svg }) => {
        if (!fresh()) return;
        const img = document.createElement("img");
        // fit the column, but never below 70%: a wider diagram scrolls
        img.style.width = `max(min(100%, ${w}px), ${w * 0.7}px)`;
        img.alt = "diagram";
        img.title = "Click to enlarge";
        img.onclick = () => enlarge(img.src, w);
        img.onload = () => {
          if (!fresh()) return;
          box.className = "cm-lp-mermaid";
          box.title = "";
          box.replaceChildren(img);
          heights.set(src, box.offsetHeight);
          if (heights.size > 200) heights.delete(heights.keys().next().value!); // typing in a diagram makes a source a key
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

// A diagram as wide as the window allows, up to twice its own size, in a modal over the page: Esc or a click closes it.
// Outside the editor, so styled here rather than in mermaidTheme.
function enlarge(src: string, w: number) {
  const d = document.createElement("dialog");
  d.style.cssText = "margin:auto;max-width:96vw;max-height:96vh;padding:24px;border:0;border-radius:10px;background:var(--bg);box-shadow:var(--pop);cursor:zoom-out";
  const img = document.createElement("img");
  img.src = src;
  img.alt = "diagram";
  img.style.cssText = `display:block;width:min(calc(96vw - 48px), ${w * 2}px)`;
  d.append(img);
  d.onclick = () => d.remove();
  d.onclose = () => d.remove();
  document.body.append(d);
  d.showModal();
}

export const mermaidTheme = EditorView.theme({
  // padding, not margin: CodeMirror can't see a block widget's margins, and clicks below it would land too low
  ".cm-lp-mermaid": { overflowX: "auto", paddingTop: "8px", paddingBottom: "8px", textAlign: "center" },
  ".cm-lp-mermaid img": { display: "inline-block", verticalAlign: "top", cursor: "zoom-in" },
  ".cm-lp-mermaid-err": { color: "var(--faint)", fontSize: "13px", textAlign: "left", cursor: "text" },
  ".cm-lp-mermaid-stale": { opacity: "0.4" },
});
