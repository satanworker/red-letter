// B: does updateRefs force:true still enforce beforeOid? (parentless CRDT snapshots, no history growth)
import { api, gql, ok, log, R } from "./lib.mjs";

const REF = "refs/red-letter/spike-force/doc";
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const root = async (m) => ok(await api("POST", `${R}/git/commits`, { message: m, tree: EMPTY_TREE, parents: [] }), m).sha;
const repoId = ok(await gql(`{ repository(owner:"satanworker", name:"red-letter"){ id } }`), "id").data.repository.id;
const upd = (u) => gql(`mutation($input: UpdateRefsInput!){ updateRefs(input:$input){ clientMutationId } }`, { input: { repositoryId: repoId, refUpdates: [u] } });
const cur = async () => (await api("GET", `${R}/git/ref/${REF.slice(5)}`)).json.object?.sha;

const s1 = await root("s1"), s2 = await root("s2"), s3 = await root("s3");
log("create", JSON.stringify((await upd({ name: REF, beforeOid: "0".repeat(40), afterOid: s1 })).json), (await cur()) === s1);
log("force, correct before", JSON.stringify((await upd({ name: REF, beforeOid: s1, afterOid: s2, force: true })).json), (await cur()) === s2);
log("force, STALE before", JSON.stringify((await upd({ name: REF, beforeOid: s1, afterOid: s3, force: true })).json), "moved?", (await cur()) === s3);
log("delete", (await api("DELETE", `${R}/git/${REF}`)).status);
