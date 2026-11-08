// CodeMirror ⇄ the Automerge doc's text. Replaces @automerge/automerge-codemirror's plugin, which recorded each
// keystroke in Automerge (A.change, its patches, automerge-repo's diff and every change listener, the panels' update
// with them) before the keystroke could paint: ~1.7 ms a key at 1k lines, ~2.7 ms at 17k. Here typing is held,
// composed into one ChangeSet, until the frame showing it has painted, or until anyone reads the doc first
// (Session.doc flushes).
//
// Invariant: the editor's text is the doc's text at `#heads` plus `#pending`. Edits from elsewhere (peers, agent
// replays, the session's own writes) that land while typing is held are concurrent with it: the typing is recorded at
// `#heads` (changeAt), then what the doc gained besides is diffed and applied to the editor.
import * as A from "@automerge/automerge";
import { decodeHeads, encodeHeads } from "@automerge/automerge-repo";
import { Annotation, ChangeSet, type ChangeSpec, type EditorState, type TransactionSpec } from "@codemirror/state";
import { ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { RLDoc, Session } from "./session.ts";

// transactions this plugin dispatches: the doc's own changes, not typing to record
const fromDoc = Annotation.define<true>();

type View = { readonly state: EditorState; dispatch(spec: TransactionSpec): void };
type Host = Pick<Session, "handle" | "flushEdits">;

export class AutomergeSync {
  #heads: A.Heads;
  #pending: ChangeSet | null = null;
  #busy = false; // recording typing: the change events that causes are ours
  #frame = 0;
  #timer = 0;

  constructor(
    readonly view: View,
    readonly host: Host,
  ) {
    this.#heads = A.getHeads(host.handle.doc()!);
    host.handle.on("change", this.#pull);
    host.flushEdits = this.flush;
  }

  update(u: Pick<ViewUpdate, "transactions">) {
    for (const tr of u.transactions)
      if (!tr.changes.empty && !tr.annotation(fromDoc)) this.#pending = this.#pending ? this.#pending.compose(tr.changes) : tr.changes;
    if (this.#pending && !this.#timer) {
      this.#frame = requestAnimationFrame(() => setTimeout(this.flush)); // a task after the frame: it has painted
      this.#timer = setTimeout(this.flush, 100); // a hidden tab runs no frames
    }
  }

  flush = () => {
    cancelAnimationFrame(this.#frame);
    clearTimeout(this.#timer);
    this.#timer = 0;
    const p = this.#pending;
    this.#pending = null;
    if (!p || p.empty) return;
    const write = (d: RLDoc) => p.iterChanges((fromA, toA, fromB, _toB, text) => A.splice(d, ["text"], fromB, toA - fromA, text.toString()));
    const { handle } = this.host;
    this.#busy = true;
    try {
      if (A.equals(A.getHeads(handle.doc()!), this.#heads)) {
        handle.change(write);
        this.#heads = A.getHeads(handle.doc()!);
      } else {
        const at = handle.changeAt(encodeHeads(this.#heads), write);
        if (at) this.#heads = decodeHeads(at);
      }
    } finally {
      this.#busy = false;
    }
  };

  // the doc changed: held typing goes in first (at the heads it was typed on), then the rest comes to the editor
  #pull = () => {
    if (this.#busy) return;
    this.flush();
    const doc = this.host.handle.doc()!, now = A.getHeads(doc);
    if (A.equals(now, this.#heads)) return;
    const patches = A.diff(doc, this.#heads, now);
    this.#heads = now;
    let changes = ChangeSet.empty(this.view.state.doc.length);
    for (const p of patches) {
      const at = p.path[1];
      let spec: ChangeSpec | null = null;
      if (p.path[0] !== "text") continue;
      if (p.action === "splice" && typeof at === "number") spec = { from: at, insert: p.value };
      else if (p.action === "del" && typeof at === "number") spec = { from: at, to: at + (p.length ?? 1) };
      else if (p.action === "put" && p.path.length === 1 && typeof p.value === "string") spec = { from: 0, to: changes.newLength, insert: p.value };
      if (spec) changes = changes.compose(ChangeSet.of(spec, changes.newLength));
    }
    // a caret where text came in stays after it, as the old binding did
    if (!changes.empty) this.view.dispatch({ changes, selection: this.view.state.selection.map(changes, 1), annotations: fromDoc.of(true) });
  };

  destroy() {
    this.flush();
    this.host.handle.off("change", this.#pull);
    this.host.flushEdits = () => {};
  }
}

export const automergeSync = (host: Host) => ViewPlugin.define((view) => new AutomergeSync(view, host));
