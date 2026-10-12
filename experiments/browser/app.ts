// Smoke prototype: CM6 + Automerge over a dumb relay, GitHub as the only database, called straight from the page.
// URL: /?repo=owner/name&branch=b&path=p.md[#automerge:<docId>]   token: localStorage.gh_token
import * as A from "@automerge/automerge";
import { Repo, type AutomergeUrl, type DocHandle, type DocumentId } from "@automerge/automerge-repo";
import { BrowserWebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";
import { automergeSyncPlugin, type DocHandle as PluginHandle } from "@automerge/automerge-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { findConflicts } from "../crdt/conflicts.ts";
import { replay } from "../crdt/replay.ts";

// conflicts: per replayed commit, cursor pairs into text; written once by the tab that applied the replay first.
type RLDoc = { text: string; git?: { commit: string; heads: string[] }; conflicts?: Record<string, { from: string; to: string }[]> };

const q = new URLSearchParams(location.search);
const [repoName, branch, path] = [q.get("repo")!, q.get("branch")!, q.get("path")!];
const token = localStorage.getItem("gh_token")!;
const logEl = document.getElementById("log")!;
const log = (...a: unknown[]) => {
  logEl.textContent += `${new Date().toISOString().slice(11, 23)} ${a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}\n`;
};
const TRAILER = "Red-Letter-Heads:";

// ---- GitHub, straight from the browser (CORS) ----
let apiCalls = 0;
async function gh(route: string, init: RequestInit & { raw?: boolean } = {}): Promise<Response> {
  apiCalls++;
  const res = await fetch(`https://api.github.com/repos/${repoName}${route}`, {
    ...init,
    cache: "no-store",
    headers: {
      authorization: `Bearer ${token}`,
      accept: init.raw ? "application/vnd.github.raw" : "application/vnd.github+json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  return res;
}
async function ghJson<T>(route: string, init?: RequestInit): Promise<T> {
  const res = await gh(route, init);
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${route} -> ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}
const filePath = path.split("/").map(encodeURIComponent).join("/");
const readFile = async (sha: string) => (await gh(`/contents/${filePath}?ref=${sha}`, { raw: true })).text();
type Commit = { sha: string; parents: { sha: string }[]; commit: { message: string; tree: { sha: string } } };

// ---- CRDT snapshot ref: refs/red-letter/v1/<sha1(branch)>/<sha1(path)> -> parentless commit {doc.automerge, meta.json} ----
const sha1 = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
const crdtRef = `refs/red-letter/v1/${await sha1(branch)}/${await sha1(path)}`;
const ZERO = "0".repeat(40);
const b64 = (u: Uint8Array) => btoa(Array.from(u, (c) => String.fromCharCode(c)).join(""));
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/\n/g, "")), (c) => c.charCodeAt(0));
type Meta = { docId: string; branch: string; path: string; commit: string; heads: string[] };

async function crdtRefSha(): Promise<string> {
  const res = await gh(`/git/ref/${crdtRef.slice("refs/".length)}`);
  if (res.status === 404) return ZERO;
  const ref: { object: { sha: string } } = await res.json();
  return ref.object.sha;
}
async function readSnapshot(sha: string): Promise<{ meta: Meta; bytes: Uint8Array }> {
  const c = await ghJson<Commit["commit"]>(`/git/commits/${sha}`);
  const tree = await ghJson<{ tree: { path: string; sha: string }[] }>(`/git/trees/${c.tree.sha}`);
  const blob = async (name: string) => unb64((await ghJson<{ content: string }>(`/git/blobs/${tree.tree.find((e) => e.path === name)!.sha}`)).content);
  return { meta: JSON.parse(new TextDecoder().decode(await blob("meta.json"))), bytes: await blob("doc.automerge") };
}
async function snapshotCommit(meta: Meta): Promise<string> {
  const post = <T>(route: string, body: unknown) => ghJson<T>(route, { method: "POST", body: JSON.stringify(body) });
  const blob = await post<{ sha: string }>(`/git/blobs`, { content: b64(A.save(handle.doc()!)), encoding: "base64" });
  const tree = await post<{ sha: string }>(`/git/trees`, {
    tree: [
      { path: "doc.automerge", mode: "100644", type: "blob", sha: blob.sha },
      { path: "meta.json", mode: "100644", type: "blob", content: JSON.stringify(meta, null, 1) },
    ],
  });
  return (await post<{ sha: string }>(`/git/commits`, { message: `red-letter snapshot ${path}@${meta.commit.slice(0, 7)}`, tree: tree.sha, parents: [] })).sha;
}
const repoId = (await ghJson<{ node_id: string }>("")).node_id;
// Atomic multi-ref CAS (REST PATCH has no CAS on non-branch refs). Any error = conflict.
async function updateRefs(refUpdates: { name: string; beforeOid: string; afterOid: string; force?: boolean }[]): Promise<boolean> {
  apiCalls++;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      query: "mutation($input: UpdateRefsInput!){ updateRefs(input:$input){ clientMutationId } }",
      variables: { input: { repositoryId: repoId, refUpdates } },
    }),
  });
  const body: { errors?: unknown[] } = await res.json();
  if (body.errors) log("updateRefs rejected", body.errors);
  return res.ok && !body.errors;
}

// ---- doc ----
const repo = new Repo({ network: [new BrowserWebSocketClientAdapter("ws://localhost:3030")] });
let handle!: DocHandle<RLDoc>; // assigned by one of the three branches below (importSnapshot included)
let crdtHead = await crdtRefSha();
async function importSnapshot() {
  const snap = await readSnapshot(crdtHead);
  handle = repo.import<RLDoc>(snap.bytes, { docId: snap.meta.docId as DocumentId });
  log("loaded snapshot", crdtHead.slice(0, 7), "doc", snap.meta.docId, "at", snap.meta.commit.slice(0, 7));
}
if (location.hash.startsWith("#automerge:")) {
  handle = await repo.find<RLDoc>(location.hash.slice(1) as AutomergeUrl);
  log("joined via relay", handle.url);
} else if (crdtHead !== ZERO) {
  await importSnapshot();
} else {
  // First opener ever: init from the file at branch head, then claim the snapshot ref. Git is the lock.
  const head = (await ghJson<{ object: { sha: string } }>(`/git/ref/heads/${branch}`)).object.sha;
  handle = repo.create<RLDoc>({ text: await readFile(head) });
  const heads = A.getHeads(handle.doc()!);
  handle.change((d) => (d.git = { commit: head, heads }));
  const snap = await snapshotCommit({ docId: handle.documentId, branch, path, commit: head, heads });
  const res = await gh(`/git/refs`, { method: "POST", body: JSON.stringify({ ref: crdtRef, sha: snap }) });
  if (res.status === 422) {
    log("lost the init race:", await res.text(), "-> loading the winner's doc");
    crdtHead = await crdtRefSha();
    await importSnapshot();
  } else {
    crdtHead = snap;
    log("created", handle.url, "from", head.slice(0, 7), "claimed", crdtRef);
  }
}
history.replaceState(null, "", `${location.search}#${handle.url}`);

// ---- conflict highlights, rendered from cursors stored in the doc (so every tab and reload sees them) ----
const setConflicts = StateEffect.define<{ from: number; to: number }[]>();
const conflictField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects)
      if (e.is(setConflicts))
        deco = Decoration.set(e.value.filter((r) => r.to > r.from).map((r) => Decoration.mark({ class: "cm-conflict" }).range(r.from, r.to)), true);
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
function conflictRanges(): { from: number; to: number }[] {
  const d = handle.doc()!;
  return Object.values(d.conflicts ?? {}).flatMap((rs) =>
    rs.map((r) => ({ from: A.getCursorPosition(d, ["text"], r.from), to: A.getCursorPosition(d, ["text"], r.to) + 1 })),
  );
}

const view = new EditorView({
  doc: handle.doc()!.text,
  // plugin's DocHandle type wants doc(): Doc<T>; repo's returns Doc<T> | undefined (handle is ready here)
  extensions: [basicSetup, markdown(), conflictField, automergeSyncPlugin({ handle: handle as unknown as PluginHandle<RLDoc>, path: ["text"] })],
  parent: document.getElementById("editor")!,
});

// ---- git -> CRDT: poll branch head, replay every first-parent commit since doc.git.commit ----
let etag = "";
let polling = false;
async function poll(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const res = await gh(`/git/ref/heads/${branch}`, { headers: etag ? { "if-none-match": etag } : {} });
    if (res.status === 304) return;
    etag = res.headers.get("etag") ?? "";
    // GitHub response shape (smoke test: trusted, not validated)
    const ref: { object: { sha: string } } = await res.json();
    const head = ref.object.sha;
    const git = handle.doc()!.git!;
    if (head === git.commit) return;
    // first-parent chain head..git.commit, oldest first
    const chain: Commit[] = [];
    for (let sha = head; sha !== git.commit && chain.length < 50; ) {
      const c = await ghJson<Commit>(`/commits/${sha}`);
      chain.unshift(c);
      if (!c.parents.length) break;
      sha = c.parents[0].sha;
    }
    let from = git.commit;
    let heads = git.heads;
    for (const c of chain) {
      const trailer = c.commit.message.split("\n").find((l) => l.startsWith(TRAILER));
      if (trailer) {
        const own = trailer.slice(TRAILER.length).trim().split(",");
        if (!A.hasHeads(handle.doc()!, own)) {
          // relay hasn't delivered that tab's ops (or is down): the snapshot written with that commit has them
          crdtHead = await crdtRefSha();
          const snap = await readSnapshot(crdtHead);
          handle.update((doc) => A.merge(doc, A.load<RLDoc>(snap.bytes)));
          log("merged snapshot", crdtHead.slice(0, 7), "for browser commit", c.sha.slice(0, 7));
          if (!A.hasHeads(handle.doc()!, own)) break;
        }
        log("browser commit", c.sha.slice(0, 7), "-> no replay");
        [from, heads] = [c.sha, own];
      } else {
        const blob = await readFile(c.sha);
        const before = A.getHeads(handle.doc()!);
        const t = performance.now();
        const r = replay(handle.doc()!, heads, from, c.sha, blob);
        // another tab may have replayed the same commit already (identical change, synced via relay)
        const fresh = r.change !== undefined && !A.hasHeads(handle.doc()!, r.heads);
        if (r.change) handle.update((d) => A.applyChanges(d, [r.change!])[0]);
        const conflicts = fresh ? findConflicts(handle.doc()!, heads, before, r.heads) : [];
        if (conflicts.length) {
          const doc = handle.doc()!;
          const anchors = conflicts.map((x) => ({ from: A.getCursor(doc, ["text"], x.from), to: A.getCursor(doc, ["text"], Math.max(x.from, x.to - 1)) }));
          handle.change((d) => {
            d.conflicts ??= {};
            d.conflicts[c.sha] = anchors;
          });
        }
        log("replayed", c.sha.slice(0, 7), r.change ? `change ${A.decodeChange(r.change).hash.slice(0, 8)}` : "(file unchanged)", fresh ? "applied here" : "already synced", `${(performance.now() - t).toFixed(0)}ms`, "conflicts", conflicts);
        [from, heads] = [c.sha, r.heads];
      }
      const done = { commit: from, heads };
      handle.change((d) => (d.git = done));
    }
  } catch (e) {
    log("poll error", String(e));
  } finally {
    polling = false;
    render();
  }
}

// ---- CRDT -> git: Git Data API with CAS ----
async function commit(attempt = 1): Promise<string | undefined> {
  const d = handle.doc()!;
  const heads = A.getHeads(d);
  const { commit: parent } = d.git!;
  if (d.text === (await readFile(parent))) {
    log("commit: nothing to commit");
    return;
  }
  const t = performance.now();
  const calls = apiCalls;
  // file commit: tree with inline content (no blob call) -> commit with heads trailer
  const post = <T>(route: string, body: unknown) => ghJson<T>(route, { method: "POST", body: JSON.stringify(body) });
  const pc = await ghJson<{ tree: { sha: string } }>(`/git/commits/${parent}`);
  const tree = await post<{ sha: string }>(`/git/trees`, { base_tree: pc.tree.sha, tree: [{ path, mode: "100644", type: "blob", content: d.text }] });
  const c = await post<{ sha: string }>(`/git/commits`, { message: `Edit ${path} in Red Letter\n\n${TRAILER} ${heads.join(",")}`, tree: tree.sha, parents: [parent] });
  // CRDT snapshot commit, then move branch + snapshot ref together
  const snap = await snapshotCommit({ docId: handle.documentId, branch, path, commit: c.sha, heads });
  const ok = await updateRefs([
    { name: `refs/heads/${branch}`, beforeOid: parent, afterOid: c.sha },
    { name: crdtRef, beforeOid: crdtHead, afterOid: snap, force: true },
  ]);
  if (!ok) {
    if (attempt >= 4) throw new Error("commit: gave up after 4 CAS failures");
    log("commit: CAS lost, replaying and retrying");
    await poll();
    crdtHead = await crdtRefSha();
    return commit(attempt + 1);
  }
  crdtHead = snap;
  handle.change((doc) => (doc.git = { commit: c.sha, heads }));
  log("committed", c.sha.slice(0, 7), "+ snapshot", snap.slice(0, 7), `${apiCalls - calls} calls`, `${(performance.now() - t).toFixed(0)}ms`, `attempt ${attempt}`);
  render();
  return c.sha;
}

function render() {
  const g = handle.doc()!.git!;
  document.getElementById("status")!.textContent = `${repoName}@${branch}:${path}  base ${g.commit.slice(0, 7)}  api calls ${apiCalls}`;
}
document.getElementById("commit")!.onclick = () => commit().catch((e) => log("commit error", String(e)));
handle.on("change", () => {
  render();
  // defer: this event can fire inside a CodeMirror update (local typing)
  queueMicrotask(() => view.dispatch({ effects: setConflicts.of(conflictRanges()) }));
});
render();
view.dispatch({ effects: setConflicts.of(conflictRanges()) });
if (q.get("poll") !== "0") setInterval(poll, 3000);
poll();

Object.assign(window, { rl: { handle, view, poll, commit, A, text: () => handle.doc()!.text, git: () => handle.doc()!.git } });
