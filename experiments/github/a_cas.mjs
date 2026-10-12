// A: CAS commit sequence + concurrent writer + retry.
import { api, ok, log, R, makeCommit } from "./lib.mjs";

const BR = "spike/cas";
const main = ok(await api("GET", `${R}/git/ref/heads/main`), "main").object.sha;
const mainCommit = ok(await api("GET", `${R}/git/commits/${main}`), "main commit");
let r = await api("POST", `${R}/git/refs`, { ref: `refs/heads/${BR}`, sha: main });
log("create branch", r.status, r.ms);

const head = async () => ok(await api("GET", `${R}/git/ref/heads/${BR}`), "ref").object.sha;
const treeOf = async (sha) => ok(await api("GET", `${R}/git/commits/${sha}`), "c").tree.sha;

// 1. Plain sequence, separate blob call: blob -> tree -> commit -> PATCH (4 calls)
{
  const t0 = performance.now();
  const { commit, timings } = await makeCommit(main, mainCommit.tree.sha, { "spike/cas.md": "# v1\n" }, "spike: v1");
  const p = await api("PATCH", `${R}/git/refs/heads/${BR}`, { sha: commit.sha, force: false });
  timings.push(["patch", p.status, p.ms]);
  log("seq(blob separate)", timings, "total_ms", Math.round(performance.now() - t0), "calls", timings.length);
}

// 2. Same, but blob inlined in tree entry `content` (3 calls)
{
  const t0 = performance.now();
  const parent = await head();
  const timings = [];
  const t = await api("POST", `${R}/git/trees`, {
    base_tree: await treeOf(parent),
    tree: [{ path: "spike/cas.md", mode: "100644", type: "blob", content: "# v2\n" }],
  });
  timings.push(["tree(inline content)", t.status, t.ms]);
  const c = await api("POST", `${R}/git/commits`, { message: "spike: v2", tree: ok(t, "tree").sha, parents: [parent] });
  timings.push(["commit", c.status, c.ms]);
  const p = await api("PATCH", `${R}/git/refs/heads/${BR}`, { sha: ok(c, "c").sha, force: false });
  timings.push(["patch", p.status, p.ms]);
  log("seq(inline content)", timings, "total_ms(excl. head/tree lookups)", timings.reduce((s, x) => s + x[2], 0));
}

// 3. Concurrent writers on same parent
const parent = await head();
const baseTree = await treeOf(parent);
const A = (await makeCommit(parent, baseTree, { "spike/cas.md": "# writer A\n" }, "spike: A")).commit;
const B = (await makeCommit(parent, baseTree, { "spike/cas.md": "# writer B\n" }, "spike: B")).commit;
r = await api("PATCH", `${R}/git/refs/heads/${BR}`, { sha: A.sha, force: false });
log("writer A PATCH", r.status, r.json.object?.sha);
r = await api("PATCH", `${R}/git/refs/heads/${BR}`, { sha: B.sha, force: false });
log("writer B PATCH (stale parent)", r.status, r.json);

// 4. Retry: rebuild B on new head
const newHead = await head();
const B2 = (await makeCommit(newHead, await treeOf(newHead), { "spike/cas.md": "# writer A\n# writer B (rebased)\n" }, "spike: B retry")).commit;
r = await api("PATCH", `${R}/git/refs/heads/${BR}`, { sha: B2.sha, force: false });
log("writer B retry PATCH", r.status, r.json.object?.sha === B2.sha);

// 5. PATCH to a sha that's not a descendant but also not stale (sibling); and force:false to same sha (no-op)
r = await api("PATCH", `${R}/git/refs/heads/${BR}`, { sha: B2.sha, force: false });
log("PATCH same sha (no-op)", r.status);
