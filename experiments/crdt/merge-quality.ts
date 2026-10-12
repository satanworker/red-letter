// Spike 1: replay an agent's pushed blob at the last-commit heads, merge with concurrent human edits.
// Compares Automerge (replay.ts), Loro forkAt+update / updateByLine, and `git merge-file`.
import * as A from "@automerge/automerge";
import { LoroDoc } from "loro-crdt";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findConflicts } from "./conflicts.ts";
import { replay, type TextDoc } from "./replay.ts";
import { scenarios } from "./scenarios.ts";

// Prototype policy: the CRDT holds LF text; the committer restores the file's EOL style.
// (Raw CRLF input makes automerge's grapheme diff misplace characters: "\r\n" is one grapheme.)
const lf = (s: string) => s.replaceAll("\r\n", "\n");

function automerge(base: string, human: string, agent: string): { text: string; flagged: string } {
  const c1 = A.from<TextDoc>({ text: lf(base) });
  const heads = A.getHeads(c1);
  const live = A.change(A.clone(c1), (d) => A.updateText(d, ["text"], lf(human)));
  const r = replay(live, heads, "c1".repeat(20), "c2".repeat(20), lf(agent));
  const text = r.doc.text;
  const marks = findConflicts(r.doc, heads, A.getHeads(live), r.heads);
  let flagged = text;
  for (const { from, to } of [...marks].reverse()) flagged = flagged.slice(0, from) + "⟦" + flagged.slice(from, to) + "⟧" + flagged.slice(to);
  return { text, flagged: marks.length ? flagged : "" };
}

function loro(base: string, human: string, agent: string, byLine: boolean): string {
  const c1 = new LoroDoc();
  c1.getText("t").insert(0, base);
  c1.commit();
  const at = c1.frontiers();
  const live = c1.fork();
  live.getText("t").update(human);
  live.commit();
  const replay = live.forkAt(at);
  const t = replay.getText("t");
  byLine ? t.updateByLine(agent) : t.update(agent);
  replay.commit();
  live.import(replay.export({ mode: "update" }));
  return live.getText("t").toString();
}

function git(base: string, human: string, agent: string): { text: string; conflicts: number } {
  const dir = mkdtempSync(join(tmpdir(), "rl-merge-"));
  const [b, h, a] = ["base", "human", "agent"].map((n) => join(dir, n));
  writeFileSync(b, base);
  writeFileSync(h, human);
  writeFileSync(a, agent);
  try {
    return { text: execFileSync("git", ["merge-file", "-p", h, b, a], { encoding: "utf8" }), conflicts: 0 };
  } catch (e) {
    // git merge-file exits with the conflict count and still prints the merged text
    const err = e as { stdout: string; status: number };
    return { text: err.stdout, conflicts: err.status };
  }
}

// Show only the region that differs from `ref`, so outputs stay readable.
function region(ref: string, s: string): string {
  let p = 0;
  while (p < ref.length && p < s.length && ref[p] === s[p]) p++;
  let q = 0;
  while (q < ref.length - p && q < s.length - p && ref[ref.length - 1 - q] === s[s.length - 1 - q]) q++;
  const ctx = 12;
  const out = s.slice(Math.max(0, p - ctx), s.length - q + ctx);
  return JSON.stringify(out);
}

const rows: string[] = [];
for (const s of scenarios) {
  const am = automerge(s.base, s.human, s.agent);
  const results = {
    automerge: am.text,
    "loro char": loro(s.base, s.human, s.agent, false),
    "loro line": loro(s.base, s.human, s.agent, true),
  };
  const g = git(s.base, s.human, s.agent);
  console.log(`\n## ${s.name}`);
  console.log(`  git merge-file: ${g.conflicts ? `CONFLICT(${g.conflicts})` : g.text === s.ideal ? "clean = ideal" : "clean " + region(s.ideal ?? s.base, g.text)}`);
  const verdicts: string[] = [];
  for (const [k, v] of Object.entries(results)) {
    const ok = s.ideal !== null && v === s.ideal;
    verdicts.push(ok ? "ideal" : s.ideal === null ? "judge" : "WRONG");
    console.log(`  ${k.padEnd(10)}: ${ok ? "= ideal" : region(s.ideal ?? s.base, v)}`);
  }
  if (am.flagged) console.log(`  flagged   : ${region(s.ideal ?? s.base, am.flagged)}`);
  rows.push(`| ${s.name} | ${g.conflicts ? "conflict" : g.text === s.ideal ? "ideal" : "clean≠ideal"} | ${verdicts.join(" | ")} | ${am.flagged ? "flagged" : "-"} |`);
}
console.log("\n| scenario | git merge-file | automerge (LF) | loro char | loro line | automerge conflict flag |\n|---|---|---|---|---|---|");
console.log(rows.join("\n"));
