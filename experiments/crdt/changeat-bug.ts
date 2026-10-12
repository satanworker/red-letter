// automerge 3.5.0: changeAt() with a concurrent text edit returns a doc whose materialized text (and patches)
// disagree with the real CRDT state ~half the time; which half depends on random actor-id ordering.
// save()/load() of the same doc is always right. The editor binding consumes patches, so users would see
// corrupted text. replay.ts (fork at heads + applyChanges) is checked the same way.
import * as A from "@automerge/automerge";
import { replay, type TextDoc } from "./replay.ts";

const base = "# Notes\n\nAgents use git.\nHumans use the browser.\n";
const blob = "# Notes\n\nAgents use git and push often.\nHumans use the browser.\n\n## New section\n";
const want = "# Notes\n\nAgents use git and push often.\nHumans use the web browser.\n\n## New section\n";

// Patches drive the editor: apply them to the editor's current string to see what the user would get.
function applyPatches(text: string, patches: A.Patch[]): string {
  for (const p of patches) {
    const at = Number(p.path[1]);
    if (p.action === "splice") text = text.slice(0, at) + p.value + text.slice(at);
    else if (p.action === "del") text = text.slice(0, at) + text.slice(at + (p.length ?? 1));
  }
  return text;
}

const N = 300;
const bad = { "changeAt .text": 0, "changeAt patches": 0, "changeAt save/load": 0, "replay .text": 0, "replay patches": 0, "replay save/load": 0 };
for (let i = 0; i < N; i++) {
  const origin = A.from<TextDoc>({ text: base });
  const heads = A.getHeads(origin);
  const live = A.change(A.clone(origin), (d) => A.splice(d, ["text"], base.indexOf("browser"), 0, "web "));

  let atPatches: A.Patch[] = [];
  const at = A.changeAt(A.clone(live), heads, { patchCallback: (p) => (atPatches = p) }, (d) => A.updateText(d, ["text"], blob)).newDoc;
  let rpPatches: A.Patch[] = [];
  const rp = replay(live, heads, i.toString(16).padStart(40, "0"), "c2".repeat(20), blob, (p) => (rpPatches = p)).doc;

  if (at.text !== want) bad["changeAt .text"]++;
  if (applyPatches(live.text, atPatches) !== want) bad["changeAt patches"]++;
  if (A.load<TextDoc>(A.save(at)).text !== want) bad["changeAt save/load"]++;
  if (rp.text !== want) bad["replay .text"]++;
  if (applyPatches(live.text, rpPatches) !== want) bad["replay patches"]++;
  if (A.load<TextDoc>(A.save(rp)).text !== want) bad["replay save/load"]++;
}
for (const [k, v] of Object.entries(bad)) console.log(`${v ? "WRONG" : "ok   "} ${k.padEnd(20)} ${v}/${N}`);
