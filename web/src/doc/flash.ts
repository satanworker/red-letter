// A brief highlight on the text an outline click went to (`.rl-flash` in app.css: held, then faded out), so the
// reader's eye finds it. Each flash is a fresh mark (its own `data-flash`), so a second click restarts the animation;
// it's taken off once faded.
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

const setFlash = StateEffect.define<{ from: number; to: number; n: number } | null>();

export const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects)
      if (e.is(setFlash))
        deco = e.value ? Decoration.set(Decoration.mark({ class: "rl-flash", attributes: { "data-flash": String(e.value.n) } }).range(e.value.from, e.value.to)) : Decoration.none;
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

let n = 0;
export function flash(view: EditorView, from: number, to: number) {
  if (from >= to) return;
  const mine = ++n;
  view.dispatch({ effects: setFlash.of({ from, to, n: mine }) });
  setTimeout(() => mine === n && view.dom.isConnected && view.dispatch({ effects: setFlash.of(null) }), 1600); // the animation's length
}
