// B follow-up: updateRefs docs, stale-beforeOid error repeatability, REST partial failure on CRDT ref.
import { api, gql, ok, log, R } from "./lib.mjs";

const BR = "spike/cas";
const CRDT = "refs/red-letter/spike-cas/doc";
let r = await gql(`{ __type(name:"Mutation"){ fields { name description } } }`);
log("updateRefs:", r.json.data.__type.fields.find((f) => f.name === "updateRefs")?.description);
r = await gql(`{ __type(name:"RefUpdate"){ description inputFields { name description } } }`);
log("RefUpdate:", r.json.data.__type);

const repoId = ok(await gql(`{ repository(owner:"satanworker", name:"red-letter"){ id } }`), "id").data.repository.id;
const mutation = `mutation($input: UpdateRefsInput!){ updateRefs(input:$input){ clientMutationId } }`;
const sha = async (ref) => ok(await api("GET", `${R}/git/ref/${ref.replace(/^refs\//, "")}`), ref).object.sha;
const fh = await sha(`refs/heads/${BR}`), ch = await sha(CRDT);
const parentOf = async (c) => ok(await api("GET", `${R}/git/commits/${c}`), "c").parents[0]?.sha;
const fileParent = await parentOf(fh); // an ancestor: valid sha, wrong beforeOid

// Single-ref stale beforeOid: error shape
r = await gql(mutation, { input: { repositoryId: repoId, refUpdates: [{ name: CRDT, beforeOid: "0".repeat(39) + "1", afterOid: ch }] } });
log("updateRefs single stale beforeOid (bogus)", r.status, r.json);
// Multi-ref, one stale: repeat twice to see if the opaque error is stable. Use no-op afterOid==current for file ref.
for (let i = 0; i < 2; i++) {
  const c = ok(await api("POST", `${R}/git/commits`, { message: "probe", tree: ok(await api("GET", `${R}/git/commits/${fh}`), "t").tree.sha, parents: [fh] }), "c").sha;
  r = await gql(mutation, { input: { repositoryId: repoId, refUpdates: [
    { name: `refs/heads/${BR}`, beforeOid: fh, afterOid: c },
    { name: CRDT, beforeOid: fileParent /* wrong */, afterOid: ch },
  ] } });
  log(`multi stale #${i}`, r.status, JSON.stringify(r.json).slice(0, 300), "file moved?", (await sha(`refs/heads/${BR}`)) === c);
}

// REST partial: CRDT ref non-FF PATCH (correct path this time)
const unrelated = ok(await api("POST", `${R}/git/commits`, { message: "unrelated", tree: "4b825dc642cb6eb9a060e54bf8d69288fbee4904", parents: [] }), "u").sha;
r = await api("PATCH", `${R}/git/${CRDT}`, { sha: unrelated, force: false });
log("REST CRDT PATCH non-FF", r.status, r.json.message);
// Can a ref point at a blob? (C) — via REST create
