// CodeMirror 6 (live preview) bound to the Automerge text. CodeMirror owns its DOM; Solid only mounts it and
// pushes decorations (agent changes, a draft's changes, conflicts, comment highlights) when the doc or the comments change.
import { automergeSyncPlugin, type DocHandle as PluginHandle } from "@automerge/automerge-codemirror";
import { EditorState, StateEffect, StateField, Transaction, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, showTooltip, type DecorationSet, type Tooltip, type TooltipView } from "@codemirror/view";
import { Show, createEffect, createSignal, onCleanup, onMount, type Accessor } from "solid-js";
import { render } from "solid-js/web";
import type { Thread } from "../comments/commentsSelectors.ts";
import { createMentions } from "../comments/Mentions.tsx";
import { AtIcon, SendIcon, TipArrow } from "../ui.tsx";
import { cancelComment, doc, docChanged, openThread, setView, startComment, submitComment } from "./docStore.ts";
import { imageUrl } from "./images.ts";
import { editorExtensions } from "./livePreview.ts";
import { cellSelection } from "./tables.ts";
import type { Region } from "./regions.ts";
import type { AgentMark, RLDoc, Session } from "./session.ts";

class DelWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly by: string,
  ) {
    super();
  }
  eq(o: DelWidget) {
    return o.text === this.text && o.by === this.by;
  }
  toDOM() {
    const el = document.createElement("del");
    el.className = "rl-del";
    el.textContent = this.text;
    el.title = `removed ${this.by}`;
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

// Figma 22:561: selecting text shows the "Add a comment" pill (#1); pushing it turns the pill into the comment box in
// place (#2). The comment shows in the side panel only once it's sent. One `create` per editor makes CodeMirror keep
// the same tooltip DOM, and a half-written comment, across doc and selection updates.
function commentTooltip() {
  const create = (view: EditorView): TooltipView => {
    const dom = document.createElement("div");
    dom.className = "sel-tip flex flex-col items-center";
    const dispose = render(() => <SelectionTip />, dom);
    return {
      dom,
      // inside a table the position is the whole widget's edge: sit on the selected text instead
      get getCoords() {
        if (!view.state.field(cellSelection)) return undefined;
        return () => (getSelection()?.rangeCount ? getSelection()!.getRangeAt(0).getBoundingClientRect() : new DOMRect());
      },
      destroy: () => {
        dispose();
        if (doc.composing) cancelComment(); // the selection went away under a draft
      },
    };
  };
  const make = (state: EditorState): Tooltip | null => {
    const sel = state.field(cellSelection) ?? state.selection.main;
    return sel.from === sel.to ? null : { pos: sel.from, end: sel.to, above: true, create };
  };
  return StateField.define<Tooltip | null>({
    create: make,
    update: (t, tr) => (tr.docChanged || tr.selection || tr.state.field(cellSelection) !== tr.startState.field(cellSelection) ? make(tr.state) : t),
    provide: (f) => showTooltip.from(f),
  });
}

function SelectionTip() {
  return (
    <>
      <Show
        when={doc.composing}
        fallback={
          <button
            title="Add a comment (⌘⌥M / Ctrl+Alt+M)"
            class="cursor-pointer rounded-lg bg-glass px-5 py-2 font-sans text-[12px] text-fg shadow-figma backdrop-blur-[2px] hover:bg-hover"
            onMouseDown={(e) => {
              e.preventDefault(); // keep the editor selection
              startComment();
            }}
          >
            Add a comment
          </button>
        }
      >
        <CommentBox />
      </Show>
      <TipArrow />
    </>
  );
}

// Figma 22:567 "Write Comment": Enter sends, Shift+Enter is a new line, Esc cancels, "@" mentions someone.
function CommentBox() {
  let input!: HTMLTextAreaElement;
  const [text, setText] = createSignal("");
  const mentions = createMentions(() => input, setText);
  onMount(() => input.focus());
  const send = () => text().trim() && submitComment(text().trim());
  const mention = () => {
    input.setRangeText(input.selectionStart && !/\s/.test(input.value[input.selectionStart - 1]!) ? " @" : "@", input.selectionStart, input.selectionEnd, "end");
    setText(input.value);
    input.focus();
    mentions.update();
  };
  return (
    <div class="relative flex w-[314px] flex-col gap-3 rounded-lg bg-glass px-5 py-3 font-sans text-[12px] text-fg backdrop-blur-[2px]">
      <div class="relative flex">
        <textarea
          ref={input}
          aria-label="Comment"
          placeholder="Add a comment…"
          rows="1"
          class="max-h-48 min-h-[15px] w-full resize-none bg-transparent outline-none [field-sizing:content] placeholder:text-muted"
          onInput={(e) => (setText(e.currentTarget.value), mentions.update())}
          onClick={mentions.update}
          onKeyDown={(e) => {
            if (mentions.onKey(e)) return;
            if (e.key === "Escape") {
              e.preventDefault();
              cancelComment();
            } else if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <mentions.List />
      </div>
      <div class="border-t border-line" />
      <div class="flex items-center gap-2.5 py-0.5">
        <button class="cursor-pointer rounded" title="Mention someone" aria-label="Mention someone" onMouseDown={(e) => e.preventDefault()} onClick={mention}>
          <AtIcon />
        </button>
      </div>
      <button
        class="absolute right-5 bottom-3 cursor-pointer rounded-full disabled:cursor-default disabled:opacity-40"
        title="Send (Enter)"
        aria-label="Send comment"
        disabled={!text().trim()}
        onMouseDown={(e) => e.preventDefault()}
        onClick={send}
      >
        <SendIcon />
      </button>
    </div>
  );
}

function decorations(session: Session, len: number, marks: AgentMark[], changes: Region[], threads: Thread[], active: string): DecorationSet {
  const out: Range<Decoration>[] = [];
  const del = (at: number, text: string, by: string) => out.push(Decoration.widget({ widget: new DelWidget(text, by), side: -1 }).range(Math.min(at, len)));
  const mark = (from: number, to: number, cls: string, attrs?: Record<string, string>) => {
    from = Math.min(from, len);
    to = Math.min(to, len);
    if (to > from) out.push(Decoration.mark({ class: cls, attributes: attrs }).range(from, to));
  };
  for (const m of marks) {
    for (const hk of m.hunks) {
      const r = session.resolve(hk);
      if (!r) continue;
      if (hk.before) del(r.from, hk.before, "by the agent");
      mark(r.from, r.to, "rl-agent", { title: `${m.author}: ${m.message}` });
    }
    for (const c of m.conflicts) {
      const r = session.resolve(c);
      if (r) mark(r.from, r.to, "rl-conflict", { title: "You and the agent both edited this. Pick a version in the panel." });
    }
  }
  for (const c of changes) {
    if (c.before) del(c.from, c.before, "in this draft");
    mark(c.from, c.to, "rl-draft", { title: "edited in this draft" });
  }
  for (const t of threads)
    if (t.range && !t.root.resolved) mark(t.range.from, t.range.to, t.root.id === active ? "rl-comment active" : "rl-comment", { "data-thread": t.root.id });
  return Decoration.set(out, true);
}

export function Editor(props: { session: Session; marks: Accessor<AgentMark[]>; changes: Accessor<Region[]>; threads: Accessor<Thread[]> }) {
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
        imageUrl.of((src) => s.imageUrl(src)),
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
      view.dispatch({ effects: setDecos.of(decorations(s, view.state.doc.length, props.marks(), props.changes(), props.threads(), doc.activeThread)) });
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
  return <div id="editor" class="[&_.cm-editor]:min-h-[calc(100%-20px)]" ref={host} onClick={click} />;
}
