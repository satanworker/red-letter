// CodeMirror keeps the text under the reader still when heights above it change (the parser reaching a stretch it
// skipped and drawing its tables, an image loading, an edit coming in), but with a scroll container outside the editor,
// as ours is (#doc), only while the editor has focus or a wheel or touch on it has just moved it. The rest of the time
// (reading, after a table-of-contents click, with the comments panel focused) the text jumped by the difference, by
// thousands of px in a long doc. This does the same for those other times: it notes which line is at the top of the
// view whenever the view scrolls, follows that line's height-map position through every update, and when it moves,
// scrolls by as much.
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

export function scrollParent(view: EditorView): HTMLElement | null {
  for (let el = view.dom.parentElement; el; el = el.parentElement) if (/auto|scroll/.test(getComputedStyle(el).overflowY)) return el;
  return null;
}

export const keepPlace = ViewPlugin.fromClass(
  class {
    scroller: HTMLElement | null;
    anchor: { pos: number; top: number } | null = null; // the top line and its top, in the latest height map
    input = 0; // the last wheel or touch on the editor: then CodeMirror keeps the place itself, as with focus
    // which line is at the top, read when layout is fresh (only on scrolling: read after an update, the line would be
    // the one heights had just moved there)
    note = () =>
      this.view.requestMeasure({
        key: this,
        read: (v) => {
          if (!this.scroller) return;
          const b = v.lineBlockAtHeight(this.scroller.getBoundingClientRect().top - v.documentTop);
          this.anchor = { pos: b.from, top: b.top };
        },
      });
    constructor(readonly view: EditorView) {
      this.scroller = scrollParent(view);
      this.scroller?.addEventListener("scroll", this.note, { passive: true });
      this.note();
    }
    update(u: ViewUpdate) {
      const a = this.anchor;
      if (!a) return;
      const pos = u.changes.mapPos(a.pos, -1), top = u.view.lineBlockAt(pos).top;
      this.anchor = { pos, top };
      const diff = top - a.top, scroller = this.scroller;
      if (scroller && Math.abs(diff) > 1 && !u.view.hasFocus && this.input < Date.now() - 100)
        u.view.requestMeasure({ read: () => null, write: () => void (scroller.scrollTop += diff) });
    }
    destroy() {
      this.scroller?.removeEventListener("scroll", this.note);
    }
  },
  {
    eventObservers: {
      wheel() { this.input = Date.now(); },
      touchstart() { this.input = Date.now(); },
    },
  },
);
