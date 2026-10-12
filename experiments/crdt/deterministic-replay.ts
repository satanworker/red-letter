// Spike 1b: serverless means every open tab polls GitHub and may replay the same agent push.
// Naive replay (random actor) duplicates the agent's text when two tabs both replay.
// Deterministic replay: actor/peer derived from (fromCommit, toCommit), fixed timestamp, applied at the
// recorded heads -> byte-identical change on every peer -> CRDT dedupes it.
import * as A from "@automerge/automerge";
import { LoroDoc } from "loro-crdt";
import { replay, replayActor, type TextDoc as Doc } from "./replay.ts";

const base = "# Notes\n\nAgents use git.\nHumans use the browser.\n";
const agentBlob = "# Notes\n\nAgents use git and push often.\nHumans use the browser.\n\n## New section\n";
const C1 = "c1".repeat(20);
const C2 = "c2".repeat(20);

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

// ---------- Automerge ----------
{
  const origin = A.from<Doc>({ text: base });
  const headsAtC1 = A.getHeads(origin);
  // two tabs, each with their own concurrent human edits since C1
  const tabA = A.change(A.clone(origin), (d) => A.splice(d, ["text"], base.indexOf("browser"), 0, "web "));
  const tabB = A.change(A.clone(origin), (d) => A.splice(d, ["text"], 0, 0, "<!-- draft -->\n"));

  // naive: random actor in each tab
  const naiveA = A.changeAt(A.clone(tabA), headsAtC1, (d) => A.updateText(d, ["text"], agentBlob)).newDoc;
  const naiveB = A.changeAt(A.clone(tabB), headsAtC1, (d) => A.updateText(d, ["text"], agentBlob)).newDoc;
  const naive = A.load<Doc>(A.save(A.merge(A.clone(naiveA), naiveB))).text; // save/load: changeAt's materialized text is unreliable
  check("naive double replay duplicates agent text", naive.split("and push often").length - 1 === 2, JSON.stringify(naive));

  // replay() from replay.ts: actor from (from, to) commits, time 0, applied at heads
  const rA = replay(tabA, headsAtC1, C1, C2, agentBlob);
  const rB = replay(tabB, headsAtC1, C1, C2, agentBlob);
  check("deterministic replay: identical change bytes across tabs", Buffer.compare(Buffer.from(rA.change!), Buffer.from(rB.change!)) === 0);
  const merged = A.merge(A.clone(rA.doc), rB.doc);
  const want = "<!-- draft -->\n# Notes\n\nAgents use git and push often.\nHumans use the web browser.\n\n## New section\n";
  check("deterministic replay: merged tabs converge without duplication", merged.text === want, JSON.stringify(merged.text));
  const replayHeads = rA.heads;
  check("invariant: text at replay heads == agent blob", A.view(merged, replayHeads).text === agentBlob);
  // replaying again (e.g. tab reloads, sees same push) is a no-op
  const again = replay(merged, headsAtC1, C1, C2, agentBlob).doc;
  check("re-replay is idempotent", again.text === merged.text && A.getHeads(again).length === A.getHeads(merged).length);
  // survives save/load (what goes into refs/red-letter)
  const loaded = A.load<Doc>(A.save(merged));
  check("save/load round trip", loaded.text === merged.text);

  // Different transition paths are NOT deduped: C1->C2->C3 vs C1->C3 produce different changes.
  const C3 = "c3".repeat(20);
  const blob3 = agentBlob + "\nmore\n";
  const step = replay(rA.doc, headsAtC1, C1, C2, agentBlob);
  const pathA = replay(step.doc, step.heads, C2, C3, blob3).doc;
  const pathB = replay(tabB, headsAtC1, C1, C3, blob3).doc;
  const mixed = A.merge(A.clone(pathA), pathB).text;
  check("skipped-commit paths diverge (must replay every first-parent commit)", mixed.split("more").length - 1 === 2, JSON.stringify(mixed));
}

// ---------- Loro ----------
{
  const origin = new LoroDoc();
  origin.setPeerId(1n);
  origin.getText("t").insert(0, base);
  origin.commit();
  const at = origin.frontiers();
  const tabA = origin.fork();
  tabA.setPeerId(2n);
  tabA.getText("t").insert(base.indexOf("browser"), "web ");
  tabA.commit();
  const tabB = origin.fork();
  tabB.setPeerId(3n);
  tabB.getText("t").insert(0, "<!-- draft -->\n");
  tabB.commit();

  function loroReplay(live: LoroDoc, from: string, to: string) {
    const fork = live.forkAt(at);
    fork.setPeerId(BigInt("0x" + replayActor(from, to).slice(0, 15)));
    fork.getText("t").update(agentBlob);
    fork.commit({ timestamp: 0, message: `red-letter replay ${from}..${to}` });
    const bytes = fork.export({ mode: "update", from: live.oplogVersion() });
    live.import(bytes);
    return bytes;
  }
  const bA = loroReplay(tabA, C1, C2);
  const bB = loroReplay(tabB, C1, C2);
  check("loro deterministic replay: identical update bytes", Buffer.compare(Buffer.from(bA), Buffer.from(bB)) === 0);
  tabA.import(tabB.export({ mode: "update" }));
  const want = "<!-- draft -->\n# Notes\n\nAgents use git and push often.\nHumans use the web browser.\n\n## New section\n";
  check("loro merged tabs converge without duplication", tabA.getText("t").toString() === want, JSON.stringify(tabA.getText("t").toString()));
}
