// Opening a link in the doc (⌘/Ctrl-click, Alt-Enter; the live preview and tables): http(s) and mailto in a new browser
// tab, anything else through `docLink`, which the Editor wires to the workspace (a repo path like `../a.md`).
import { Facet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

type Open = (href: string) => boolean;
export const docLink = Facet.define<Open, Open>({ combine: (v) => v[0] ?? (() => false) });

// false: not a link this opens (the click places the caret instead)
export function openHref(view: EditorView, href: string): boolean {
  if (!/^(https?:|mailto:)/i.test(href)) return view.state.facet(docLink)(href);
  window.open(href, "_blank", "noopener");
  return true;
}
