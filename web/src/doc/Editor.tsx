// CodeMirror 6 (live preview) bound to the Automerge text. CodeMirror owns its DOM; Solid only mounts it and
// pushes decorations (agent changes, conflicts, comment highlights) when the doc or the comments change.
import { automergeSyncPlugin, type DocHandle as PluginHandle } from "@automerge/automerge-codemirror";
import { EditorState, StateEffect, StateField, Transaction, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, showTooltip, type DecorationSet, type Tooltip } from "@codemirror/view";
import { createEffect, onCleanup, onMount, type Accessor } from "solid-js";
import type { Thread } from "../comments/commentsSelectors.ts";
import { CommentIcon } from "../ui.tsx";
import { doc, docChanged, openThread, setView, startComment } from "./docStore.ts";
import { editorExtensions } from "./livePreview.ts";
import { cellSelection } from "./tables.ts";
import type { AgentMark, RLDoc, Session } from "./session.ts";

class DelWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(o: DelWidget) {
    return o.text === this.text;
  }
  toDOM() {
    const el = document.createElement("del");
    el.className = "rl-del";
    el.textContent = this.text;
    el.title = "removed by the agent";
    return el;
  }
}

const setDecos = StateEffect.define<DecorationSet>();
const decoField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(d, tr) {
    d = d.map(tr.changes);
    for (const e of tr.effects) if (e.is(setDecos)) d = e.value;
    return d;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// Remote changes (peers, agent replays) must not land on the local undo stack: one Ctrl-Z must never revert
// someone else's edit. The automerge binding dispatches them without a userEvent; local typing always has one.
const remoteNotUndoable = EditorState.transactionExtender.of((tr) =>
  tr.docChanged && !tr.annotation(Transaction.userEvent) ? { annotations: Transaction.addToHistory.of(false) } : null,
);

// Notion-style floating "Comment" button above a non-empty selection, or text selected in a table cell.
function commentTooltip() {
  const make = (state: EditorState): Tooltip | null => {
    const cell = state.field(cellSelection);
    const sel = cell ?? state.selection.main;
    if (sel.from === sel.to) return null;
    return {
      pos: sel.from,
      end: sel.to,
      above: true,
      create: () => {
        const dom = (
          <div class="sel-tip">
            <button
              onMouseDown={(e) => {
                e.preventDefault(); // keep the editor selection
                startComment();
              }}
            >
              <CommentIcon /> Comment
            </button>
          </div>
        ) as HTMLElement;
        // inside a table the position is the whole widget's edge: sit on the selected text instead
        const coords = () => (getSelection()?.rangeCount ? getSelection()!.getRangeAt(0).getBoundingClientRect() : new DOMRect());
        return cell ? { dom, getCoords: coords } : { dom };
      },
    };
  };
  return StateField.define<Tooltip | null>({
    create: make,
    update: (t, tr) => (tr.docChanged || tr.selection || tr.state.field(cellSelection) !== tr.startState.field(cellSelection) ? make(tr.state) : t),
    provide: (f) => showTooltip.from(f),
  });
}

function decorations(session: Session, len: number, marks: AgentMark[], threads: Thread[], active: string): DecorationSet {
  const out: Range<Decoration>[] = [];
  const mark = (from: number, to: number, cls: string, attrs?: Record<string, string>) => {
    from = Math.min(from, len);
    to = Math.min(to, len);
    if (to > from) out.push(Decoration.mark({ class: cls, attributes: attrs }).range(from, to));
  };
  for (const m of marks) {
    for (const hk of m.hunks) {
      const r = session.resolve(hk);
      if (!r) continue;
      if (hk.before) out.push(Decoration.widget({ widget: new DelWidget(hk.before), side: -1 }).range(Math.min(r.from, len)));
      mark(r.from, r.to, "rl-agent", { title: `${m.author}: ${m.message}` });
    }
    for (const c of m.conflicts) {
      const r = session.resolve(c);
      if (r) mark(r.from, r.to, "rl-conflict", { title: "You and the agent both edited this. Pick a version in the panel." });
    }
  }
  for (const t of threads)
    if (t.range && !t.root.resolved) mark(t.range.from, t.range.to, t.root.id === active ? "rl-comment active" : "rl-comment", { "data-thread": t.root.id });
  return Decoration.set(out, true);
}

export function Editor(props: { session: Session; marks: Accessor<AgentMark[]>; threads: Accessor<Thread[]> }) {
  let host!: HTMLDivElement;
  onMount(() => {
    const s = props.session;
    const view = new EditorView({
      doc: s.doc.text,
      extensions: [
        ...editorExtensions(),
        decoField,
        remoteNotUndoable,
        EditorState.readOnly.of(!s.canWrite),
        s.canWrite ? commentTooltip() : [],
        keymap.of([
          { key: "Mod-s", preventDefault: true, run: () => (void s.save(), true) },
          { key: "Mod-Alt-m", preventDefault: true, run: () => (startComment(), true) },
        ]),
        // automerge-repo's handle.doc() may be undefined before ready; it is ready here
        automergeSyncPlugin({ handle: s.handle as unknown as PluginHandle<RLDoc>, path: ["text"] }),
      ],
      parent: host,
    });
    setView(view);
    createEffect(() => {
      doc.version; // the CRDT doc changed
      if (view.state.doc.length !== s.doc.text.length) return docChanged(); // binding hasn't caught up: next frame
      view.dispatch({ effects: setDecos.of(decorations(s, view.state.doc.length, props.marks(), props.threads(), doc.activeThread)) });
    });
    onCleanup(() => {
      setView(undefined);
      view.destroy();
    });
  });
  // clicking a comment highlight opens its thread
  const click = (e: MouseEvent) => {
    const id = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-thread]")?.dataset.thread : undefined;
    if (id) openThread(id);
  };
  return <div id="editor" ref={host} onClick={click} />;
}
