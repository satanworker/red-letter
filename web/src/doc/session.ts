// One open file: CRDT doc <-> git. Snapshot ref load/claim, poll + deterministic replay of agent commits,
// CAS commit of file + snapshot, agent-change and conflict marks stored in the doc.
// This browser keeps a copy of the doc in IndexedDB: a file opens from it at once and catches up with git after.
import * as A from "@automerge/automerge";
import { Repo, type DocHandle, type DocumentId, type PeerId } from "@automerge/automerge-repo";
import { HUB, HttpError, b64, cachedGet, encPath, gh, post, sha1, token, unb64, updateRefs } from "../github.ts";
import { idbDelete, idbGet, idbPut } from "../idb.ts";
import { HubAdapter } from "./hub.ts";
import { editRegions, findConflicts, type Region } from "./regions.ts";
import { REPLAY_VERSION, replay } from "./replay.ts";

// Ranges are stored as cursors: `from` = first char (inclusive), `to` = char after the range (exclusive) or "end".
export type Anchor = { from: string; to: string };
export type Hunk = Anchor & { before: string };
export type ConflictMark = Hunk & { human: string; agent: string };
export type AgentMark = { sha: string; author: string; message: string; at: string; hunks: Hunk[]; conflicts: ConflictMark[] };
export type RLDoc = { text: string; git?: { commit: string; heads: string[] }; marks?: Record<string, AgentMark> };
type Meta = { docId: string; branch: string; path: string; commit: string; heads: string[]; replayVersion: number };
type Local = { docId: string; bytes: Uint8Array; crlf: boolean; crdtHead: string };
type GitCommit = { sha: string; parents: { sha: string }[]; message: string; author: { name: string; date: string }; tree: { sha: string } };

const TRAILER = "Red-Letter-Heads:";
const ZERO = "0".repeat(40);
const lf = (s: string) => s.replaceAll("\r\n", "\n");
// fetch() throws TypeError when there's no connection at all
const errText = (e: unknown) => (e instanceof TypeError ? "can't reach GitHub" : String(e instanceof Error ? e.message : e));

// people: GitHub logins of other tabs on this file (peer ids are "<login>-<random>")
export type Status = { saving: boolean; dirty: boolean; error?: string; commit: string; people: string[]; online: boolean };

// The snapshot ref now holds a different doc (the ref was deleted and recreated): this browser's copy is stale.
export class DocReset extends Error {}

export const NO_SNAPSHOT = ZERO;
const docKey = (repo: string, branch: string, path: string) => `${repo.toLowerCase()} ${branch} ${path}`;
export const snapshotRef = async (branch: string, path: string) => `refs/red-letter/v1/${await sha1(branch)}/${await sha1(path)}`;

// Every snapshot ref of a branch in one request (ETag-revalidated): ref name -> snapshot commit.
// fresh: after losing a race, when a recent shared answer would be stale.
export async function snapshotHeads(repo: string, branch: string, fresh = false): Promise<Map<string, string>> {
  const refs: { ref: string; object: { sha: string } }[] = JSON.parse(await cachedGet(`/repos/${repo}/git/matching-refs/red-letter/v1/${await sha1(branch)}/`, { fresh }));
  return new Map(refs.map((r) => [r.ref, r.object.sha]));
}

// Everything a snapshot is made of is addressed by sha, so it's cached for good.
async function object<T>(repo: string, kind: "commits" | "trees" | "blobs", sha: string): Promise<T> {
  return JSON.parse(await cachedGet(`/repos/${repo}/git/${kind}/${sha}`, { immutable: true }));
}

async function readSnapshot(repo: string, sha: string): Promise<{ meta: Meta; bytes: Uint8Array }> {
  const c = await object<GitCommit>(repo, "commits", sha);
  const tree = await object<{ tree: { path: string; sha: string }[] }>(repo, "trees", c.tree.sha);
  const blob = async (name: string) => unb64((await object<{ content: string }>(repo, "blobs", tree.tree.find((e) => e.path === name)!.sha)).content);
  const [metaBytes, bytes] = await Promise.all([blob("meta.json"), blob("doc.automerge")]);
  const meta: Meta = JSON.parse(new TextDecoder().decode(metaBytes));
  if ((meta.replayVersion ?? 1) > REPLAY_VERSION) throw new Error("This file was saved by a newer Red Letter. Reload the page.");
  return { meta, bytes };
}

const fileAt = (repo: string, path: string, sha: string) => cachedGet(`/repos/${repo}/contents/${encPath(path)}?ref=${sha}`, { raw: true, immutable: true });

// Background sync, read-only: bring this browser's copy of a doc up to its snapshot so opening it is instant.
// Files nobody opened yet have no snapshot; their text at `branchHead` is fetched so the first open is quicker.
// `isOpen` is checked right before writing: an open file's Session owns its copy.
export async function syncCopy(repo: string, branch: string, path: string, snapshot: string, branchHead: string, isOpen: () => boolean) {
  if (snapshot === ZERO) {
    await fileAt(repo, path, branchHead);
    return;
  }
  const key = docKey(repo, branch, path);
  const local = await idbGet<Local>("docs", key);
  if (local?.crdtHead === snapshot) return;
  const snap = await readSnapshot(repo, snapshot);
  const same = local?.docId === snap.meta.docId; // a different doc means the ref was recreated: theirs wins
  const bytes = local && same ? A.save(A.merge(A.load<RLDoc>(local.bytes), A.load<RLDoc>(snap.bytes))) : snap.bytes;
  const crlf = local && same ? local.crlf : (await fileAt(repo, path, snap.meta.commit).catch(() => "")).includes("\r\n");
  if (!isOpen()) await idbPut("docs", key, { docId: snap.meta.docId, bytes, crlf, crdtHead: snapshot } satisfies Local);
}

export class Session {
  handle!: DocHandle<RLDoc>;
  status: Status = { saving: false, dirty: false, commit: "", people: [], online: false };
  onStatus: () => void = () => {};
  // Resolves once the doc has caught up with git (or failed to: see status.error). Rejects with DocReset.
  synced: Promise<void> = Promise.resolve();
  log: (...a: unknown[]) => void = (...a) => console.log("[rl]", ...a);

  #repo: Repo;
  #hub?: HubAdapter;
  #crdtRef = "";
  #crdtHead = ZERO;
  #crlf = false;
  #polling?: Promise<void>;
  #saving?: Promise<void>;
  #autosave: number | undefined;
  #localTimer: number | undefined;
  readonly #key: string;

  constructor(
    readonly repoName: string,
    readonly repoId: string,
    readonly branch: string,
    readonly path: string,
    readonly canWrite: boolean,
    login: string,
  ) {
    this.#key = docKey(repoName, branch, path);
    const peerId = `${login}-${crypto.randomUUID().slice(0, 8)}` as PeerId;
    if (canWrite) {
      const doc = encodeURIComponent(`${branch}:${path}`);
      this.#hub = new HubAdapter(`${HUB.replace(/^http/, "ws")}/sync?repo=${encodeURIComponent(repoName)}&doc=${doc}`, token);
      this.#hub.onStatus = (s) => {
        Object.assign(this.status, { online: s.connected, people: s.peers.map((p) => p.replace(/-[0-9a-f]{8}$/, "")) });
        if (s.error) this.status.error = `live sync: ${s.error}`;
        this.onStatus();
      };
    }
    // Read-only viewers don't join live sync: any sync peer can inject ops a writer would later commit.
    this.#repo = new Repo({ peerId, network: this.#hub ? [this.#hub] : [], sharePolicy: async () => true });
  }

  get doc(): A.Doc<RLDoc> {
    return this.handle.doc()!;
  }
  get docId() {
    return this.handle.documentId;
  }

  async #file(sha: string): Promise<string> {
    const text = await fileAt(this.repoName, this.path, sha);
    this.#crlf = text.includes("\r\n");
    return lf(text);
  }

  async #headSha(): Promise<string> {
    const ref: { object: { sha: string } } = JSON.parse(await cachedGet(`/repos/${this.repoName}/git/ref/heads/${encPath(this.branch)}`));
    return ref.object.sha;
  }

  async #crdtRefSha(fresh = false): Promise<string> {
    return (await snapshotHeads(this.repoName, this.branch, fresh)).get(this.#crdtRef) ?? ZERO;
  }

  async #snapshotCommit(commit: string, heads: string[]): Promise<string> {
    const meta: Meta = { docId: this.docId, branch: this.branch, path: this.path, commit, heads, replayVersion: REPLAY_VERSION };
    const blob = await post<{ sha: string }>(`/repos/${this.repoName}/git/blobs`, { content: b64(A.save(this.doc)), encoding: "base64" });
    const tree = await post<{ sha: string }>(`/repos/${this.repoName}/git/trees`, {
      tree: [
        { path: "doc.automerge", mode: "100644", type: "blob", sha: blob.sha },
        { path: "meta.json", mode: "100644", type: "blob", content: JSON.stringify(meta, null, 1) },
      ],
    });
    const msg = `red-letter snapshot ${this.path}@${commit.slice(0, 7)}`;
    return (await post<{ sha: string }>(`/repos/${this.repoName}/git/commits`, { message: msg, tree: tree.sha, parents: [] })).sha;
  }

  // create: a new file with this text. It opens at once; the file and its snapshot are committed by a save in
  // the background (one atomic updateRefs, like any save).
  async open(create?: string) {
    this.#crdtRef = await snapshotRef(this.branch, this.path);
    if (create !== undefined) return this.#create(create);
    const local = await idbGet<Local>("docs", this.#key);
    if (local) {
      this.handle = this.#repo.import<RLDoc>(local.bytes, { docId: local.docId as DocumentId });
      this.#crlf = local.crlf;
      this.#crdtHead = local.crdtHead;
      this.log("opened this browser's copy");
      this.#watch();
      this.synced = this.#catchUp();
      return;
    }
    this.#crdtHead = await this.#crdtRefSha();
    if (this.#crdtHead !== ZERO) {
      const snap = await readSnapshot(this.repoName, this.#crdtHead);
      this.handle = this.#repo.import<RLDoc>(snap.bytes, { docId: snap.meta.docId as DocumentId });
      await this.#file(snap.meta.commit).catch(() => {}); // learn the file's EOL style
      this.log("loaded snapshot", this.#crdtHead.slice(0, 7), "at", snap.meta.commit.slice(0, 7));
    } else {
      // First opener ever: init from the file at branch head, then claim the snapshot ref. Git is the lock.
      const head = await this.#headSha();
      this.handle = this.#repo.create<RLDoc>({ text: await this.#file(head) });
      const heads = A.getHeads(this.doc);
      this.handle.change((d) => (d.git = { commit: head, heads }));
      if (this.canWrite) {
        const snap = await this.#snapshotCommit(head, heads);
        const res = await gh(`/repos/${this.repoName}/git/refs`, { method: "POST", body: JSON.stringify({ ref: this.#crdtRef, sha: snap }) });
        if (res.status === 422) {
          this.log("another tab created this doc first; loading theirs");
          this.#crdtHead = await this.#crdtRefSha(true);
          const theirs = await readSnapshot(this.repoName, this.#crdtHead);
          this.handle = this.#repo.import<RLDoc>(theirs.bytes, { docId: theirs.meta.docId as DocumentId });
        } else if (!res.ok) throw new HttpError(res.status, `claim snapshot ref: ${res.status} ${await res.text()}`);
        else this.#crdtHead = snap;
      }
    }
    this.#watch();
    this.#flushLocal();
    this.synced = this.poll();
  }

  async #create(text: string) {
    const head = await this.#headSha();
    // committed text = "" (the file doesn't exist yet), so the starting text counts as an unsaved edit
    this.handle = this.#repo.create<RLDoc>({ text: "" });
    this.handle.change((d) => (d.git = { commit: head, heads: A.getHeads(d) }));
    this.handle.change((d) => A.splice(d, ["text"], 0, 0, text));
    this.#watch();
    this.#flushLocal();
    this.synced = this.save();
  }

  // Opened from this browser's copy: merge what others saved since (their snapshot), then replay agent commits.
  async #catchUp() {
    try {
      const head = await this.#crdtRefSha();
      if (head !== ZERO && head !== this.#crdtHead) {
        const snap = await readSnapshot(this.repoName, head);
        if (snap.meta.docId !== this.docId) {
          await idbDelete("docs", this.#key);
          throw new DocReset(`${this.path} was recreated by someone else`);
        }
        this.handle.update((d) => A.merge(d, A.load<RLDoc>(snap.bytes)));
        this.#crdtHead = head;
      }
    } catch (e) {
      if (e instanceof DocReset) throw e;
      this.status.error = errText(e);
      this.onStatus();
      return;
    }
    await this.poll();
  }

  #watch() {
    this.status.commit = this.doc.git!.commit;
    this.handle.on("change", () => {
      this.status.commit = this.doc.git!.commit;
      this.#markDirty();
      // any tab with unsaved text (its own or peers') saves 30-40 s after the last change; the first save wins,
      // the others find nothing left to commit
      if (this.status.dirty) this.#scheduleAutosave();
      this.#localTimer ??= window.setTimeout(() => this.#flushLocal(), 1000);
    });
    // text left unsaved by an earlier visit (offline, tab closed) goes to git like fresh edits
    this.#markDirty();
    if (this.status.dirty) this.#scheduleAutosave();
  }

  // ponytail: saves the whole doc, at most once a second; automerge-repo's incremental IndexedDB adapter if docs get big
  #flushLocal() {
    clearTimeout(this.#localTimer);
    this.#localTimer = undefined;
    const local: Local = { docId: this.docId, bytes: A.save(this.doc), crlf: this.#crlf, crdtHead: this.#crdtHead };
    void idbPut("docs", this.#key, local);
  }

  // Leaving the file without leaving the page: keep the copy, leave live sync at once, and send unsaved text to
  // git if nobody else is here to (their autosave covers it otherwise).
  close() {
    this.onStatus = () => {};
    if (this.handle) this.#flushLocal(); // open() may have failed before there was a doc
    clearTimeout(this.#autosave);
    const alone = this.status.people.length === 0;
    void this.#repo.shutdown();
    if (this.canWrite && this.status.dirty && alone) void this.save();
  }

  #committedText(): string {
    return A.view(this.doc, this.doc.git!.heads).text;
  }

  #markDirty() {
    const dirty = this.doc.text !== this.#committedText();
    if (dirty !== this.status.dirty) {
      this.status.dirty = dirty;
      this.onStatus();
    }
  }

  #scheduleAutosave() {
    if (!this.canWrite) return;
    clearTimeout(this.#autosave);
    this.#autosave = window.setTimeout(() => void this.save(), 30_000 + Math.random() * 10_000);
  }

  // ---- git -> CRDT ----
  // fresh: ask GitHub (the 15 s tick, saves). Otherwise share a recent answer: opening a file, the route and
  // background sync all look at the branch head within the same second.
  poll(fresh = false): Promise<void> {
    return (this.#polling ??= this.#poll(fresh).finally(() => (this.#polling = undefined)));
  }

  async #poll(fresh: boolean) {
    try {
      const ref: { object: { sha: string } } = JSON.parse(await cachedGet(`/repos/${this.repoName}/git/ref/heads/${encPath(this.branch)}`, { fresh }));
      if (fresh) this.status.error = undefined; // GitHub answered: an earlier "can't reach" is over
      const head = ref.object.sha;
      const git = this.doc.git!;
      if (head === git.commit) return;
      // first-parent chain head..git.commit, oldest first
      const chain: GitCommit[] = [];
      let connected = false;
      for (let sha = head; chain.length < 50; ) {
        if (sha === git.commit) {
          connected = true;
          break;
        }
        const c = await object<GitCommit>(this.repoName, "commits", sha);
        chain.unshift(c);
        if (!c.parents.length) break;
        sha = c.parents[0].sha;
      }
      // ponytail: history rewritten or >50 commits behind -> one jump; tabs at other commits may then duplicate text
      const steps = connected ? chain : chain.slice(-1);
      if (!connected) this.log("branch history doesn't connect to the doc's commit; replaying as one jump");
      let from = git.commit;
      let heads = git.heads;
      for (const c of steps) {
        const trailer = c.message.split("\n").find((l) => l.startsWith(TRAILER));
        if (trailer) {
          const own = trailer.slice(TRAILER.length).trim().split(",");
          if (!A.hasHeads(this.doc, own)) {
            // that tab's ops haven't reached us via the hub; the snapshot written with that commit has them
            this.#crdtHead = await this.#crdtRefSha(true);
            const snap = await readSnapshot(this.repoName, this.#crdtHead);
            this.handle.update((d) => A.merge(d, A.load<RLDoc>(snap.bytes)));
            if (!A.hasHeads(this.doc, own)) break;
          }
          [from, heads] = [c.sha, own];
        } else {
          [from, heads] = [c.sha, await this.#replay(c, from, heads)];
        }
        const done = { commit: from, heads };
        this.handle.change((d) => (d.git = done));
      }
    } catch (e) {
      this.status.error = errText(e);
    } finally {
      this.status.commit = this.doc.git!.commit; // a peer may have advanced it via sync
      this.#markDirty();
      this.onStatus();
    }
  }

  async #replay(c: GitCommit, from: string, heads: A.Heads): Promise<A.Heads> {
    // a commit where this file doesn't exist (yet, or any more) has it empty
    const blob = await this.#file(c.sha).catch((e) => (e instanceof HttpError && e.status === 404 ? "" : Promise.reject(e)));
    const humanHeads = A.getHeads(this.doc);
    const r = replay(this.doc, heads, from, c.sha, blob);
    if (!r.change) return heads; // commit didn't touch this file
    // another tab may already have replayed the same commit (identical change, synced via the hub)
    const fresh = !A.hasHeads(this.doc, r.heads);
    this.handle.update((d) => A.applyChanges(d, [r.change!])[0]);
    if (fresh) {
      const doc = this.doc;
      const anchor = (g: Region): Hunk => ({ ...this.anchor(g.from, g.to), before: g.before });
      const mark: AgentMark = {
        sha: c.sha,
        author: c.author.name,
        message: c.message.split("\n")[0],
        at: c.author.date,
        hunks: editRegions(doc, heads, r.heads, humanHeads).map(anchor),
        conflicts: findConflicts(doc, heads, humanHeads, r.heads).map((g) => ({ ...anchor(g), human: g.human, agent: g.agent })),
      };
      this.handle.change((d) => {
        d.marks ??= {};
        d.marks[c.sha] = mark;
      });
      this.log("replayed", c.sha.slice(0, 7), `${mark.hunks.length} changes, ${mark.conflicts.length} conflicts`);
    }
    return r.heads;
  }

  // ---- anchors ----
  anchor(from: number, to: number): Anchor {
    const d = this.doc;
    const at = (i: number) => A.getCursor(d, ["text"], i >= d.text.length ? "end" : i);
    return { from: at(from), to: at(to) };
  }

  resolve(a: Anchor): { from: number; to: number } | null {
    try {
      const from = A.getCursorPosition(this.doc, ["text"], a.from);
      const to = A.getCursorPosition(this.doc, ["text"], a.to);
      return { from, to: Math.max(from, to) };
    } catch {
      return null; // cursor from another doc identity
    }
  }

  // ---- images ----
  #images = new Map<string, Promise<string | null>>();
  // `diagrams/a.svg` (next to this file), `../a.png` or `/docs/a.png` (repo root) at this branch, as a blob URL.
  // Absolute URLs pass through. GitHub's raw bytes come untyped: an SVG needs its type to render in an <img>.
  imageUrl(src: string): Promise<string | null> {
    if (/^(https?:|data:|blob:)/.test(src)) return Promise.resolve(src);
    let url = this.#images.get(src);
    if (!url) {
      const dir = this.path.split("/").slice(0, -1).map((s) => `${s}/`).join("");
      const path = decodeURIComponent(new URL(src, `https://repo/${dir}`).pathname.slice(1));
      url = gh(`/repos/${this.repoName}/contents/${encPath(path)}?ref=${encodeURIComponent(this.branch)}`, { raw: true })
        .then(async (res) => (res.ok ? URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: path.endsWith(".svg") ? "image/svg+xml" : "" })) : null))
        .catch(() => null);
      this.#images.set(src, url);
    }
    return url;
  }

  revertHunk(sha: string, i: number) {
    const h = this.doc.marks?.[sha]?.hunks[i];
    const r = h && this.resolve(h);
    if (!h || !r) return;
    this.handle.change((d) => {
      A.splice(d, ["text"], r.from, r.to - r.from, h.before);
      d.marks![sha].hunks.splice(i, 1);
    });
  }

  // Replace an interleaved conflict region with one side's version.
  resolveConflict(sha: string, i: number, text: string) {
    const c = this.doc.marks?.[sha]?.conflicts[i];
    const r = c && this.resolve(c);
    if (!c || !r) return;
    this.handle.change((d) => {
      A.splice(d, ["text"], r.from, r.to - r.from, text);
      d.marks![sha].conflicts.splice(i, 1);
    });
  }

  dismiss(sha: string) {
    this.handle.change((d) => {
      delete d.marks?.[sha];
    });
  }

  // ---- CRDT -> git ----
  save(): Promise<void> {
    if (!this.canWrite) return Promise.resolve();
    clearTimeout(this.#autosave);
    return (this.#saving ??= this.#save().finally(() => (this.#saving = undefined)));
  }

  async #save(attempt = 1): Promise<void> {
    this.status.saving = true;
    this.onStatus();
    try {
      await this.poll(true); // build on the newest head
      const d = this.doc;
      const heads = A.getHeads(d);
      const parent = d.git!.commit;
      if (d.text === this.#committedText()) return;
      const content = this.#crlf ? d.text.replaceAll("\n", "\r\n") : d.text;
      const pc = await object<GitCommit>(this.repoName, "commits", parent);
      const tree = await post<{ sha: string }>(`/repos/${this.repoName}/git/trees`, {
        base_tree: pc.tree.sha,
        tree: [{ path: this.path, mode: "100644", type: "blob", content }],
      });
      const message = `Edit ${this.path} in Red Letter\n\n${TRAILER} ${heads.join(",")}`;
      const c = await post<{ sha: string }>(`/repos/${this.repoName}/git/commits`, { message, tree: tree.sha, parents: [parent] });
      const snap = await this.#snapshotCommit(c.sha, heads);
      const err = await updateRefs(this.repoId, [
        { name: `refs/heads/${this.branch}`, beforeOid: parent, afterOid: c.sha },
        { name: this.#crdtRef, beforeOid: this.#crdtHead, afterOid: snap, force: true },
      ]);
      if (err) {
        if (attempt >= 4) throw new Error(`save failed after ${attempt} attempts: ${err}`);
        this.log("save lost a race, replaying and retrying:", err);
        this.#crdtHead = await this.#crdtRefSha(true);
        return this.#save(attempt + 1);
      }
      this.#crdtHead = snap;
      this.handle.change((doc) => (doc.git = { commit: c.sha, heads }));
      this.status.commit = c.sha;
      this.status.error = undefined;
      this.log("saved", c.sha.slice(0, 7));
    } catch (e) {
      this.status.error = errText(e);
      if (e instanceof TypeError) this.#scheduleAutosave(); // offline: try again later, edits stay in this browser
    } finally {
      this.status.saving = false;
      this.#markDirty();
      this.onStatus();
    }
  }
}
