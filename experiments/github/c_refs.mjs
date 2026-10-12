// C: custom refs/red-letter/* via REST: create, blob target, read, list, D/F conflicts.
import { api, ok, log, R } from "./lib.mjs";

const main = ok(await api("GET", `${R}/git/ref/heads/main`), "main").object.sha;
const blob = ok(await api("POST", `${R}/git/blobs`, { content: "raw crdt bytes", encoding: "utf-8" }), "blob").sha;

let r = await api("POST", `${R}/git/refs`, { ref: "refs/red-letter/main/x", sha: main });
log("create refs/red-letter/main/x -> commit", r.status, r.json.ref);
r = await api("POST", `${R}/git/refs`, { ref: "refs/red-letter/main/blobref", sha: blob });
log("create ref -> blob", r.status, r.json.object ?? r.json);
r = await api("GET", `${R}/git/ref/red-letter/main/blobref`);
log("GET blob ref", r.status, r.json.object);
r = await api("GET", `${R}/git/ref/red-letter/main/x`);
log("GET /git/ref/red-letter/main/x", r.status, r.json.ref, r.json.object?.type);
r = await api("GET", `${R}/git/matching-refs/red-letter/`);
log("GET matching-refs/red-letter/", r.status, r.json.map?.((x) => `${x.ref}:${x.object.type}`));
r = await api("GET", `${R}/branches?per_page=100`);
log("GET /branches names", r.status, r.json.map((b) => b.name));
r = await api("GET", `${R}/git/refs?per_page=100`);
log("GET /git/refs (all)", r.status, r.json.map((x) => x.ref));

// Ref name validity: path chars
for (const name of ["refs/red-letter/main/docs/a.md", "refs/red-letter/feat%2Fx/a.md", "refs/red-letter/sp ace", "refs/red-letter/a..b", "refs/red-letter/x.lock", "refs/red-letter/~bad"]) {
  r = await api("POST", `${R}/git/refs`, { ref: name, sha: main });
  log("create", JSON.stringify(name), r.status, r.json.message ?? "ok");
}

// D/F conflict
r = await api("POST", `${R}/git/refs`, { ref: "refs/red-letter/t/docs", sha: main });
log("D/F: create refs/red-letter/t/docs", r.status);
r = await api("POST", `${R}/git/refs`, { ref: "refs/red-letter/t/docs/a.md", sha: main });
log("D/F: create refs/red-letter/t/docs/a.md", r.status, r.json);
r = await api("POST", `${R}/git/refs`, { ref: "refs/red-letter/u/docs/a.md", sha: main });
log("D/F reverse: create refs/red-letter/u/docs/a.md", r.status);
r = await api("POST", `${R}/git/refs`, { ref: "refs/red-letter/u/docs", sha: main });
log("D/F reverse: create refs/red-letter/u/docs", r.status, r.json);
// duplicate create = lock semantics
r = await api("POST", `${R}/git/refs`, { ref: "refs/red-letter/main/x", sha: main });
log("duplicate create", r.status, r.json);
