// Images show under their markdown line, which stays visible (muted) and editable, as in the Figma design:
// `![architecture](diagrams/architecture.svg)` with the picture below it. `imageUrl` turns a src into something an
// <img> can load: the Editor wires it to Session.imageUrl, which reads repo-relative files from GitHub.
import { Facet } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import { blockField } from "./blocks.ts";

type Resolve = (src: string) => Promise<string | null>;

export const imageUrl = Facet.define<Resolve, Resolve>({
  combine: (v) => v[0] ?? (async (src) => (/^https?:\/\//.test(src) ? src : null)),
});

// Drawn heights by src: CodeMirror counts an undrawn widget as one line unless told, so a far image remembered at its
// size keeps the doc's estimated height (and the text under the reader) from jumping when it's drawn again. An image
// never drawn is hidden until it loads, 0px.
const heights = new Map<string, number>();

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly resolve: Resolve,
  ) {
    super();
  }
  eq(o: ImageWidget) {
    return o.src === this.src && o.alt === this.alt;
  }
  get estimatedHeight() {
    return heights.get(this.src) ?? 0;
  }
  toDOM() {
    const img = document.createElement("img");
    img.className = "cm-lp-img";
    img.alt = this.alt;
    img.hidden = true; // until it loads: a missing file shows nothing rather than a broken-image box
    img.onload = () => {
      img.hidden = false;
      heights.set(this.src, img.offsetHeight);
    };
    void this.resolve(this.src).then((url) => url && (img.src = url));
    return img;
  }
}

// Block widgets can't come from a view plugin, so images live in a state field (blocks.ts: a change rescans only the
// blocks it touched).
export const imageField = blockField((state, block, out) =>
  block.cursor().iterate((n) => {
    if (n.name === "Table" || n.name === "FencedCode" || n.name === "CodeBlock") return false; // tableField renders tables
    if (n.name !== "Image") return;
    const url = n.node.getChild("URL");
    if (!url) return false;
    const marks = n.node.getChildren("LinkMark");
    const alt = marks.length > 1 ? state.doc.sliceString(marks[0]!.to, marks[1]!.from) : "";
    const widget = new ImageWidget(state.doc.sliceString(url.from, url.to), alt, state.facet(imageUrl));
    out.push(Decoration.widget({ widget, block: true, side: 1 }).range(state.doc.lineAt(n.to).to));
    return false;
  }),
);
