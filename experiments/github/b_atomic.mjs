// B: file commit + CRDT ref update. Two REST PATCHes vs GraphQL updateRefs (multi-ref, atomic?).
import { api, gql, ok, log, R, makeCommit } from "./lib.mjs";

const BR = "spike/cas";
const CRDT = "refs/red-letter/spike-cas/doc";
const head = async () => ok(await api("GET", `${R}/git/ref/heads/${BR}`), "ref").object.sha;
const treeOf = async (sha) => ok(await api("GET", `${R}/git/commits/${sha}`), "c").tree.sha;

// Option 1: two REST writes. CRDT ref -> commit whose tree holds doc.automerge + meta.json (no parent).
const fileHead = await head();
const fakeCrdt = Buffer.from([0x85, 0x6f, 0x4a, 0x83, 1, 2, 3, 0, 255]).toString("base64"); // binary
const crdtBlob = ok(await api("POST", `${R}/git/blobs`, { content: fakeCrdt, encoding: "base64" }), "blob");
const crdtTree = ok(await api("POST", `${R}/git/trees`, { tree: [
  { path: "doc.automerge", mode: "100644", type: "blob", sha: crdtBlob.sha },
  { path: "meta.json", mode: "100644", type: "blob", content: JSON.stringify({ commit_sha: fileHead, path: "spike/cas.md" }) },
] }), "tree");
const crdtCommit = ok(await api("POST", `${R}/git/commits`, { message: "crdt", tree: crdtTree.sha, parents: [] }), "c");
let r = await api("POST", `${R}/git/refs`, { ref: CRDT, sha: crdtCommit.sha });
log("create CRDT ref (commit)", r.status);
// binary roundtrip check
r = await api("GET", `${R}/git/blobs/${crdtBlob.sha}`);
log("binary blob roundtrip equal", Buffer.from(r.json.content, "base64").equals(Buffer.from(fakeCrdt, "base64")));

// Introspect GraphQL for multi-ref mutations
r = await gql(`{ __type(name:"Mutation"){ fields { name description } } }`);
const muts = r.json.data.__type.fields.filter((f) => /ref|commit/i.test(f.name));
log("ref/commit mutations", muts.map((m) => `${m.name}: ${(m.description || "").slice(0, 160)}`));
r = await gql(`{ __type(name:"RefUpdate"){ inputFields { name type { name kind ofType { name } } } } }`);
log("RefUpdate fields", r.json.data?.__type?.inputFields?.map((f) => f.name) ?? r.json);

const repoId = ok(await gql(`{ repository(owner:"satanworker", name:"red-letter"){ id } }`), "id").data.repository.id;
const b64 = (s) => Buffer.from(s).toString("base64");
const mutation = `mutation($input: UpdateRefsInput!){ updateRefs(input:$input){ clientMutationId } }`;

// Build new file commit + new CRDT commit, then update both refs in one updateRefs call.
async function pair(tag) {
  const fh = await head();
  const crdtHead = ok(await api("GET", `${R}/git/ref/${CRDT.slice(5)}`), "crdt").object.sha;
  const { commit } = await makeCommit(fh, await treeOf(fh), { "spike/cas.md": `# ${tag}\n` }, `spike: ${tag}`);
  const cc = ok(await api("POST", `${R}/git/commits`, { message: `crdt ${tag}`, tree: crdtTree.sha, parents: [crdtHead] }), "cc");
  return { fh, crdtHead, file: commit.sha, crdt: cc.sha };
}

let p = await pair("atomic-ok");
let t0 = performance.now();
r = await gql(mutation, { input: { repositoryId: repoId, refUpdates: [
  { name: `refs/heads/${BR}`, beforeOid: p.fh, afterOid: p.file },
  { name: CRDT, beforeOid: p.crdtHead, afterOid: p.crdt },
] } });
log("updateRefs both (correct beforeOid)", r.status, Math.round(performance.now() - t0), "ms", r.json);
log("  heads now", await head() === p.file, ok(await api("GET", `${R}/git/ref/${CRDT.slice(5)}`), "x").object.sha === p.crdt);

// Failure case: file beforeOid correct, CRDT beforeOid stale -> does file ref move?
p = await pair("atomic-fail");
r = await gql(mutation, { input: { repositoryId: repoId, refUpdates: [
  { name: `refs/heads/${BR}`, beforeOid: p.fh, afterOid: p.file },
  { name: CRDT, beforeOid: crdtCommit.sha /* stale */, afterOid: p.crdt },
] } });
log("updateRefs with one stale beforeOid", r.status, r.json);
log("  file ref moved?", (await head()) === p.file, "crdt ref moved?", ok(await api("GET", `${R}/git/ref/${CRDT.slice(5)}`), "x").object.sha === p.crdt);

// Failure case: non-fast-forward with force omitted on a branch (beforeOid correct but afterOid unrelated)
const fh2 = await head();
const unrelated = ok(await api("POST", `${R}/git/commits`, { message: "unrelated", tree: crdtTree.sha, parents: [] }), "u").sha;
r = await gql(mutation, { input: { repositoryId: repoId, refUpdates: [
  { name: `refs/heads/${BR}`, beforeOid: fh2, afterOid: unrelated },
] } });
log("updateRefs non-FF, force default", r.status, r.json);

// Option 1 partial failure: REST file PATCH ok, CRDT PATCH fails (stale/non-FF)
p = await pair("rest-partial");
r = await api("PATCH", `${R}/git/refs/heads/${BR}`, { sha: p.file, force: false });
log("REST file PATCH", r.status);
r = await api("PATCH", `${R}/git/${CRDT.slice(5)}`, { sha: unrelated, force: false });
log("REST CRDT PATCH non-FF", r.status, r.json.message, "-> file ref already moved; CRDT meta.commit_sha now behind branch head");

// createCommitOnBranch with expectedHeadOid (single branch, true CAS)
const fh3 = await head();
t0 = performance.now();
r = await gql(`mutation($i: CreateCommitOnBranchInput!){ createCommitOnBranch(input:$i){ commit{ oid } } }`, { i: {
  branch: { repositoryNameWithOwner: "satanworker/red-letter", branchName: BR },
  expectedHeadOid: fh3,
  message: { headline: "spike: createCommitOnBranch" },
  fileChanges: { additions: [{ path: "spike/cas.md", contents: b64("# via graphql\n") }] },
} });
log("createCommitOnBranch", r.status, Math.round(performance.now() - t0), "ms", r.json);
r = await gql(`mutation($i: CreateCommitOnBranchInput!){ createCommitOnBranch(input:$i){ commit{ oid } } }`, { i: {
  branch: { repositoryNameWithOwner: "satanworker/red-letter", branchName: BR },
  expectedHeadOid: fh3, // stale now
  message: { headline: "spike: stale" },
  fileChanges: { additions: [{ path: "spike/cas.md", contents: b64("# stale\n") }] },
} });
log("createCommitOnBranch stale expectedHeadOid", r.status, r.json);
