// bun src/doc/sync.check.ts: two peers edit the same text through sync.ts while their typing is held back and the
// other's changes arrive at random moments (sync is a merge of the other's doc, as the hub delivers it). Afterwards both
// editors and both docs hold the same text, and with inserts only, every typed character is in it.
import * as A from "@automerge/automerge";
import { Repo, type DocHandle } from "@automerge/automerge-repo";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { RLDoc } from "./session.ts";
import { AutomergeSync } from "./sync.ts";

globalThis.requestAnimationFrame = () => 0; // flushes happen when the check says
globalThis.cancelAnimationFrame = () => {};

let seed = 7;
const rand = (n: number) => {
  seed = (seed * 1103515245 + 12345) % 2 ** 31;
  return (seed >>> 16) % n; // an LCG's low bits cycle (seed % 2 alternates)
};

function peer(handle: DocHandle<RLDoc>) {
  const host = { handle, flushEdits: () => {} };
  const view = {
    state: EditorState.create({ doc: handle.doc()!.text }),
    dispatch(spec: TransactionSpec) {
      const tr = view.state.update(spec);
      view.state = tr.state;
      sync.update({ transactions: [tr] });
    },
  };
  const sync = new AutomergeSync(view, host);
  return { handle, view, sync, host };
}

function run(deletes: boolean) {
  const a = new Repo({ network: [] }).create<RLDoc>({ text: "the quick brown fox\njumps over the lazy dog\n" });
  const b = new Repo({ network: [] }).import<RLDoc>(A.save(a.doc()!));
  const peers = [peer(a), peer(b)];
  let typed = 0;
  for (let step = 0; step < 400; step++) {
    const p = peers[rand(2)]!, other = peers.find((q) => q !== p)!;
    const op = rand(10);
    if (op < 6) {
      const len = p.view.state.doc.length, from = rand(len + 1), del = deletes ? Math.min(rand(4), len - from) : 0;
      const insert = ["a", "bc", "\n", "def ", ""][rand(5)]!;
      typed += insert.length - del;
      p.view.dispatch({ changes: { from, to: from + del, insert }, userEvent: "input" });
    } else if (op < 8) p.sync.flush();
    else if (op < 9) p.host.flushEdits(); // a reader (Session.doc) wanting the doc
    else p.handle.update((d) => A.merge(d, other.handle.doc()!)); // the other's changes arrive
  }
  for (const p of peers) p.sync.flush();
  a.update((d) => A.merge(d, b.doc()!));
  b.update((d) => A.merge(d, a.doc()!));
  const texts = [a.doc()!.text, b.doc()!.text, ...peers.map((p) => p.view.state.doc.toString())];
  if (new Set(texts).size !== 1) throw new Error(`peers differ:\n${texts.map((t) => JSON.stringify(t)).join("\n")}`);
  if (!deletes && texts[0]!.length !== 44 + typed) throw new Error(`typed ${typed} characters, ${texts[0]!.length - 44} arrived`);
  for (const p of peers) p.sync.destroy();
}

for (let i = 0; i < 20; i++) run(i % 2 === 0);
console.log("automerge sync: ok");
