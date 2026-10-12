// A: latency distribution of the 3-call save (tree w/ inline content -> commit -> PATCH), parent+tree known.
import { api, ok, log, R } from "./lib.mjs";

const BR = "spike/cas";
let head = ok(await api("GET", `${R}/git/ref/heads/${BR}`), "ref").object.sha;
let tree = ok(await api("GET", `${R}/git/commits/${head}`), "c").tree.sha;
const rows = [];
for (let i = 0; i < 5; i++) {
  const t = await api("POST", `${R}/git/trees`, { base_tree: tree, tree: [{ path: "spike/cas.md", mode: "100644", type: "blob", content: `# run ${i}\n` }] });
  const c = await api("POST", `${R}/git/commits`, { message: `spike: lat ${i}`, tree: ok(t, "t").sha, parents: [head] });
  const p = await api("PATCH", `${R}/git/refs/heads/${BR}`, { sha: ok(c, "c").sha, force: false });
  ok(p, "patch");
  rows.push([t.ms, c.ms, p.ms, t.ms + c.ms + p.ms]);
  head = c.json.sha; tree = t.json.sha; // client keeps state: no re-reads between saves
}
const med = (k) => rows.map((r) => r[k]).sort((a, b) => a - b)[2];
log("rows [tree,commit,patch,total]", rows, "median", [0, 1, 2, 3].map(med));
