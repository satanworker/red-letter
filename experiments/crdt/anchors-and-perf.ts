// Spike 1c: comment anchors (Automerge cursors) across replay, tabs and save/load; plus size/speed on a big doc.
import * as A from "@automerge/automerge";
import { findConflicts } from "./conflicts.ts";
import { replay, type TextDoc } from "./replay.ts";

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

// ---- anchors ----
{
  const base = "# Usage\n\n- open a link\n- edit the file\n- leave a comment\n\n## FAQ\n\nQ: Does it change my file?\n";
  const c1 = A.from<TextDoc>({ text: base });
  const heads = A.getHeads(c1);
  const quote = "edit the file";
  const at = base.indexOf(quote);
  // comment row as stored on the comments branch: cursor pair + context for re-anchoring if identity is lost
  const comment = {
    from: A.getCursor(c1, ["text"], at),
    to: A.getCursor(c1, ["text"], at + quote.length - 1),
    quote,
  };
  const resolve = (d: A.Doc<TextDoc>) => {
    const s = A.getCursorPosition(d, ["text"], comment.from);
    const e = A.getCursorPosition(d, ["text"], comment.to) + 1;
    return d.text.slice(s, e);
  };
  console.log(`cursor encoding: ${comment.from} (${comment.from.length} chars)`);

  const live = A.change(A.clone(c1), (d) => A.splice(d, ["text"], base.indexOf("file") , 0, "shared "));
  const agentBlob = "# Usage\n\nSteps:\n\n- open a link\n- edit the file\n- leave a comment\n\n## FAQ\n\nQ: Does Red Letter change my file?\n";
  const r = replay(live, heads, "c1".repeat(20), "c2".repeat(20), agentBlob);
  check("anchor follows text through human edit + agent replay", resolve(r.doc) === "edit the shared file", JSON.stringify(resolve(r.doc)));
  check("anchor survives save/load", resolve(A.load<TextDoc>(A.save(r.doc))) === "edit the shared file");

  // a second tab that replayed the same push resolves the same anchor identically
  const tab2 = replay(A.clone(c1), heads, "c1".repeat(20), "c2".repeat(20), agentBlob).doc;
  const merged = A.merge(A.clone(tab2), r.doc);
  check("anchor stable after merging tab that replayed same push", resolve(merged) === "edit the shared file");

  // agent deletes the anchored line -> cursor resolves to a collapsed/neighbouring range; detect via quote
  const gone = replay(A.clone(c1), heads, "c1".repeat(20), "c3".repeat(20), base.replace("- edit the file\n", "")).doc;
  const g = resolve(gone);
  check("deleted anchor is detectable (resolved text != quote)", g !== quote, JSON.stringify(g));

  // doc identity lost (someone re-inits from the git blob): cursors from old doc do not resolve
  const fresh = A.from<TextDoc>({ text: base });
  let threw = false;
  try {
    A.getCursorPosition(fresh, ["text"], comment.from);
  } catch {
    threw = true;
  }
  check("old cursor in a re-initialised doc throws (need quote fallback)", threw);
}

// ---- size / speed on a realistic doc ----
{
  const para = "Red Letter lets humans and agents edit the same markdown file. Agents use git; humans use the browser.\n\n";
  const base = Array.from({ length: 500 }, (_, i) => `## Section ${i}\n\n${para}`).join(""); // ~60 KB
  let doc = A.from<TextDoc>({ text: base });
  const heads = A.getHeads(doc);
  let t = performance.now();
  // 5,000 single-character keystrokes, one change each (what the editor binding produces)
  for (let i = 0; i < 5000; i++) {
    const pos = (i * 7919) % doc.text.length;
    doc = A.change(doc, (d) => A.splice(d, ["text"], pos, 0, "x"));
  }
  const typing = performance.now() - t;
  const humanHeads = A.getHeads(doc);
  const saved = A.save(doc);
  // agent rewrites 50 sections (~10% of the file)
  const agentBlob = base.replace(/Agents use git; humans use the browser\./g, (m, off: number) => (off % 10 === 0 ? "Agents push; people edit." : m));
  t = performance.now();
  const r = replay(doc, heads, "c1".repeat(20), "c2".repeat(20), agentBlob);
  const replayMs = performance.now() - t;
  t = performance.now();
  const conflicts = findConflicts(r.doc, heads, humanHeads, r.heads);
  const conflictMs = performance.now() - t;
  t = performance.now();
  A.load(saved);
  const loadMs = performance.now() - t;
  console.log(
    `60KB doc, 5k keystroke changes: typing ${(typing / 5000).toFixed(2)} ms/keystroke, save ${(saved.length / 1024).toFixed(0)} KB, ` +
      `load ${loadMs.toFixed(0)} ms, replay ${replayMs.toFixed(0)} ms, findConflicts ${conflictMs.toFixed(0)} ms (${conflicts.length} regions)`,
  );
  check("saved doc fits comfortably in a git blob (<1 MB)", saved.length < 1024 * 1024);
}
