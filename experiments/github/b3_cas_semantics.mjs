// B/C follow-up: is beforeOid a real CAS? Does REST force:false enforce FF on non-branch refs?
import { api, gql, ok, log, R } from "./lib.mjs";

const BR = "refs/heads/spike/cas";
const CRDT = "refs/red-letter/spike-cas/doc";
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const sha = async (ref) => ok(await api("GET", `${R}/git/ref/${ref.slice(5)}`), ref).object.sha;
const commit = async (parents, message = "probe") =>
  ok(await api("POST", `${R}/git/commits`, { message, tree: EMPTY_TREE, parents }), "c").sha;
const repoId = ok(await gql(`{ repository(owner:"satanworker", name:"red-letter"){ id } }`), "id").data.repository.id;
const updateRefs = (refUpdates) => gql(`mutation($input: UpdateRefsInput!){ updateRefs(input:$input){ clientMutationId } }`, { input: { repositoryId: repoId, refUpdates } });

// 1. REST non-FF on custom ref
let cur = await sha(CRDT);
let unrelated = await commit([], "unrelated root");
let r = await api("PATCH", `${R}/git/${CRDT}`, { sha: unrelated, force: false });
log("1 REST PATCH custom ref non-FF force:false", r.status, "ref now == unrelated?", (await sha(CRDT)) === unrelated);
// same on branch for contrast
const bh = await sha(BR);
r = await api("PATCH", `${R}/git/${BR}`, { sha: await commit([], "unrelated root 2"), force: false });
log("1b REST PATCH branch non-FF force:false", r.status, r.json.message);

// 2. updateRefs: stale-but-ancestor beforeOid + FF afterOid (custom ref, then branch)
const a = await commit([await sha(CRDT)], "a"); // child of current
r = await updateRefs([{ name: CRDT, beforeOid: await sha(CRDT), afterOid: a }]);
log("2a advance custom ref", JSON.stringify(r.json));
const staleBefore = unrelated === a ? null : (await api("GET", `${R}/git/commits/${a}`)).json.parents[0].sha; // == previous head
const b = await commit([a], "b");
r = await updateRefs([{ name: CRDT, beforeOid: staleBefore, afterOid: b }]);
log("2b custom ref: stale(ancestor) beforeOid, FF afterOid ->", JSON.stringify(r.json), "moved?", (await sha(CRDT)) === b);

const bp = (await api("GET", `${R}/git/commits/${bh}`)).json.parents[0].sha;
const bc = await commit([bh], "branch child");
r = await updateRefs([{ name: BR, beforeOid: bp, afterOid: bc }]);
log("2c branch: stale(ancestor) beforeOid, FF afterOid ->", JSON.stringify(r.json), "moved?", (await sha(BR)) === bc);

// 3. updateRefs: correct beforeOid, non-FF afterOid, force omitted (custom ref)
cur = await sha(CRDT);
unrelated = await commit([], "unrelated 3");
r = await updateRefs([{ name: CRDT, beforeOid: cur, afterOid: unrelated }]);
log("3 custom ref: correct beforeOid, non-FF, no force ->", JSON.stringify(r.json), "moved?", (await sha(CRDT)) === unrelated);
r = await updateRefs([{ name: CRDT, beforeOid: await sha(CRDT), afterOid: await commit([], "u4"), force: true }]);
log("3b custom ref: correct beforeOid, non-FF, force:true ->", JSON.stringify(r.json));

// 4. updateRefs create (beforeOid zeros) when ref already exists -> lock semantics
r = await updateRefs([{ name: CRDT, beforeOid: "0".repeat(40), afterOid: await sha(CRDT) }]);
log("4 create-if-absent on existing ref ->", JSON.stringify(r.json));
const NEW = "refs/red-letter/spike-cas/created-by-updaterefs";
r = await updateRefs([{ name: NEW, beforeOid: "0".repeat(40), afterOid: await sha(CRDT) }]);
log("4b create-if-absent new ref ->", JSON.stringify(r.json), (await api("GET", `${R}/git/ref/${NEW.slice(5)}`)).status);
r = await updateRefs([{ name: NEW, beforeOid: await sha(NEW), afterOid: "0".repeat(40) }]);
log("4c delete via updateRefs ->", JSON.stringify(r.json), (await api("GET", `${R}/git/ref/${NEW.slice(5)}`)).status);
