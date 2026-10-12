// H: comments on an orphan branch via Git Data API, appended with CAS.
import { api, ok, log, R, makeCommit } from "./lib.mjs";

const BR = "spike/red-letter-comments";
const PATH = "main/spike/cas.md.json"; // <branch>/<file path>.json
const c1 = { id: "c1", author: "satanworker", anchor: { start: "cursor-a", end: "cursor-b" }, context: "Red-letter Bibles print the important words", body: "first", parent: null };
const c2 = { id: "c2", author: "satanworker", anchor: { start: "cursor-c", end: "cursor-d" }, context: "annotation layer over a canonical text", body: "reply", parent: "c1" };

const first = await makeCommit(null, null, { [PATH]: JSON.stringify([c1], null, 2) + "\n" }, "comments: c1");
log("orphan commit parents", first.commit.parents.length, first.timings);
let r = await api("POST", `${R}/git/refs`, { ref: `refs/heads/${BR}`, sha: first.commit.sha });
log("create orphan branch", r.status);

// Append c2 with CAS: read head + file, write new commit, PATCH force:false
const head = ok(await api("GET", `${R}/git/ref/heads/${BR}`), "ref").object.sha;
const cur = await api("GET", `${R}/contents/${PATH}?ref=${head}`, null, { accept: "application/vnd.github.raw+json" });
const list = JSON.parse(cur.text).concat(c2);
const tree = ok(await api("GET", `${R}/git/commits/${head}`), "c").tree.sha;
const second = await makeCommit(head, tree, { [PATH]: JSON.stringify(list, null, 2) + "\n" }, "comments: c2");
r = await api("PATCH", `${R}/git/refs/heads/${BR}`, { sha: second.commit.sha, force: false });
log("append c2 PATCH", r.status);
// a stale appender (built on `head`) loses
const stale = await makeCommit(head, tree, { [PATH]: JSON.stringify([c1, { ...c2, id: "c3" }], null, 2) + "\n" }, "comments: c3 stale");
r = await api("PATCH", `${R}/git/refs/heads/${BR}`, { sha: stale.commit.sha, force: false });
log("stale append PATCH", r.status, r.json.message);
