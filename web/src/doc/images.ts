// Images show under their markdown line, which stays visible (muted) and editable, as in the Figma design:
// `![architecture](diagrams/architecture.svg)` with the picture below it. `imageUrl` turns a src into something an
// <img> can load: the Editor wires it to Session.imageUrl, which reads repo-relative files from GitHub.
import { syntaxTree } from "@codemirror/language";
import { Facet, StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

type Resolve = (src: string) => Promise<string | null>;

export const imageUrl = Facet.define<Resolve, Resolve>({
  combine: (v) => v[0] ?? (async (src) => (/^https?:\/\//.test(src) ? src : null)),
});

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
  toDOM() {
    const img = document.createElement("img");
    img.className = "cm-lp-img";
    img.alt = this.alt;
    img.hidden = true; // until it loads: a missing file shows nothing rather than a broken-image box
    img.onload = () => (img.hidden = false);
    void this.resolve(this.src).then((url) => url && (img.src = url));
    return img;
  }
}

function images(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = [];
  const resolve = state.facet(imageUrl);
  syntaxTree(state).iterate({
    enter: (n) => {
      if (n.name === "Table") return false; // tableField renders tables
      if (n.name !== "Image") return;
      const url = n.node.getChild("URL");
      if (!url) return false;
      const marks = n.node.getChildren("LinkMark");
      const alt = marks.length > 1 ? state.doc.sliceString(marks[0]!.to, marks[1]!.from) : "";
      const widget = new ImageWidget(state.doc.sliceString(url.from, url.to), alt, resolve);
      out.push(Decoration.widget({ widget, block: true, side: 1 }).range(state.doc.lineAt(n.to).to));
      return false;
    },
  });
  return Decoration.set(out, true);
}

// Block widgets can't come from a view plugin.
export const imageField = StateField.define<DecorationSet>({
  create: images,
  update: (deco, tr) => (tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState) ? images(tr.state) : deco),
  provide: (f) => EditorView.decorations.from(f),
});
