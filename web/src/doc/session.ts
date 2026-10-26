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

// Ranges are stored as cursors: `from` = first char (inclusive); `to` = the range's last char, as a "before" cursor
// (Automerge prefixes those with "-"), so text typed right after the range stays out of it. Anchors written before
// that (no "-") hold the char after the range, or "end"; an empty range is `from` twice.
export type Anchor = { from: string; to: string };
export type Hunk = Anchor & { before: string };
export type ConflictMark = Hunk & { human: string; agent: string };
export type AgentMark = { sha: string; author: string; message: string; at: string; hunks: Hunk[]; conflicts: ConflictMark[] };
// A draft: this branch forked from `branch` to edit this file. `commit`: the base branch's last commit merged into
// the draft; `heads`: where the doc's text is exactly that commit's (the next merge from the base replays there);
// `inGit`: the last of those commits recorded as a git merge parent (behind `commit` until that merge is saved).
export type Base = { branch: string; commit: string; heads: string[]; inGit: string };
// images: pictures pasted or dropped into this doc, src as linked -> git blob sha (uploaded at once). A save commits
// the ones the text links to, next to the file.
export type RLDoc = { text: string; git?: { commit: string; heads: string[] }; marks?: Record<string, AgentMark>; base?: Base; images?: Record<string, string> };
type Meta = { docId: string; branch: string; path: string; commit: string; heads: string[]; replayVersion: number };
type Local = { docId: string; bytes: Uint8Array; crlf: boolean; crdtHead: string };
type GitCommit = { sha: string; parents: { sha: string }[]; message: string; author: { name: string; date: string }; tree: { sha: string } };

const TRAILER = "Red-Letter-Heads:";
const ZERO = "0".repeat(40);
const lf = (s: string) => s.replaceAll("\r\n", "\n");
// fetch() throws TypeError when there's no connection at all
const errText = (e: unknown) => (e instanceof TypeError ? "can't reach GitHub" : String(e instanceof Error ? e.message : e));

// people: GitHub logins of other tabs on this file (peer ids are "<login>-<random>")
// baseHead: a draft's base branch head, as of the last poll
export type Status = { saving: boolean; dirty: boolean; error?: string; commit: string; people: string[]; online: boolean; baseHead: string };

// The snapshot ref now holds a different doc (the ref was deleted and recreated): this browser's copy is stale.
export class DocReset extends Error {}

export const NO_SNAPSHOT = ZERO;
const docKey = (repo: string, branch: string, path: string) => `${repo.toLowerCase()} ${branch} ${path}`;
export const snapshotRef = async (branch: string, path: string) => `refs/red-letter/v1/${await sha1(branch)}/${await sha1(path)}`;
async function headOf(repo: string, branch: string, fresh = false): Promise<string> {
  const ref: { object: { sha: string } } = JSON.parse(await cachedGet(`/repos/${repo}/git/ref/heads/${encPath(branch)}`, { fresh }));
  return ref.object.sha;
}

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
  status: Status = { saving: false, dirty: false, commit: "", people: [], online: false, baseHead: "" };
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
  // draftOf: this branch was just forked from that one to draft this file; the doc records it as its base.
  async open(create?: string, draftOf?: string) {
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
      const head = await headOf(this.repoName, this.branch);
      this.handle = this.#repo.create<RLDoc>({ text: await this.#file(head) });
      const heads = A.getHeads(this.doc);
      this.handle.change((d) => {
        d.git = { commit: head, heads };
        if (draftOf) d.base = { branch: draftOf, commit: head, heads, inGit: head };
      });
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
    const head = await headOf(this.repoName, this.branch);
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
      const head = await headOf(this.repoName, this.branch, fresh);
      if (fresh) this.status.error = undefined; // GitHub answered: an earlier "can't reach" is over
      if (this.doc.base) this.status.baseHead = await headOf(this.repoName, this.doc.base.branch, fresh);
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
        const own = trailer?.slice(TRAILER.length).trim().split(",") ?? [];
        if (trailer && !A.hasHeads(this.doc, own)) {
          // that tab's ops haven't reached us via the hub; the snapshot written with that commit has them
          this.#crdtHead = await this.#crdtRefSha(true);
          const snap = this.#crdtHead !== ZERO && (await readSnapshot(this.repoName, this.#crdtHead));
          if (snap) this.handle.update((d) => A.merge(d, A.load<RLDoc>(snap.bytes)));
        }
        // a trailer whose heads aren't in this doc even now is another file's save: replayed like any commit
        // (usually a no-op here)
        const ours = trailer !== undefined && A.hasHeads(this.doc, own);
        [from, heads] = [c.sha, ours ? own : await this.#replay(c, from, heads)];
        const done = { commit: from, heads: [...heads] }; // heads may be the doc's own array; automerge refuses to re-reference it
        const merged = ours && c.parents[1]?.sha; // another tab saved this draft's merge from its base
        this.handle.change((d) => {
          d.git = done;
          if (merged && d.base?.commit === merged) d.base.inGit = merged;
        });
      }
    } catch (e) {
      this.status.error = errText(e);
    } finally {
      this.status.commit = this.doc.git!.commit; // a peer may have advanced it via sync
      this.#markDirty();
      this.onStatus();
    }
  }

  async #replay(c: GitCommit, from: string, heads: A.Heads, message = c.message.split("\n")[0]): Promise<A.Heads> {
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
        message,
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
    // "before": if that char is deleted, the end moves back onto the char before it
    return { from: at(from), to: to > from ? A.getCursor(d, ["text"], to - 1, "before") : at(from) };
  }

  resolve(a: Anchor): { from: number; to: number } | null {
    try {
      const from = A.getCursorPosition(this.doc, ["text"], a.from);
      const to = A.getCursorPosition(this.doc, ["text"], a.to) + (a.to.startsWith("-") ? 1 : 0);
      return { from, to: Math.max(from, to) };
    } catch {
      return null; // cursor from another doc identity
    }
  }

  // ---- images ----
  #images = new Map<string, Promise<string | null>>();
  // `diagrams/a.svg` (next to this file), `../a.png` or `/docs/a.png` (repo root) -> repo path
  #repoPath(src: string): string {
    const dir = this.path.split("/").slice(0, -1).map((s) => `${s}/`).join("");
    return decodeURIComponent(new URL(src, `https://repo/${dir}`).pathname.slice(1));
  }
  // A repo-relative src at this branch (or a pasted image's blob, before it's saved), as a blob URL.
  // Absolute URLs pass through. GitHub's raw bytes come untyped: an SVG needs its type to render in an <img>.
  imageUrl(src: string): Promise<string | null> {
    if (/^(https?:|data:|blob:)/.test(src)) return Promise.resolve(src);
    let url = this.#images.get(src);
    if (!url) {
      const path = this.#repoPath(src);
      const blob = this.doc.images?.[src];
      url = gh(blob ? `/repos/${this.repoName}/git/blobs/${blob}` : `/repos/${this.repoName}/contents/${encPath(path)}?ref=${encodeURIComponent(this.branch)}`, { raw: true })
        .then(async (res) => (res.ok ? URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: path.endsWith(".svg") ? "image/svg+xml" : "" })) : null))
        .catch(() => null);
      this.#images.set(src, url);
    }
    return url;
  }

  // Upload a pasted/dropped image as a git blob and record it in the doc; returns the src to link, `images/<name>-<sha>.<ext>`
  // next to this file. null: the upload failed (status.error says why).
  async addImage(file: File): Promise<string | null> {
    try {
      const { sha } = await post<{ sha: string }>(`/repos/${this.repoName}/git/blobs`, { content: b64(new Uint8Array(await file.arrayBuffer())), encoding: "base64" });
      const ext = /\.(\w+)$/.exec(file.name)?.[1]?.toLowerCase() ?? file.type.split("/")[1]?.split("+")[0] ?? "png";
      const stem = file.name.replace(/\.\w+$/, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "image";
      const src = `images/${stem}-${sha.slice(0, 7)}.${ext}`;
      this.#images.set(src, Promise.resolve(URL.createObjectURL(file)));
      this.handle.change((d) => {
        d.images ??= {};
        d.images[src] = sha;
      });
      return src;
    } catch (e) {
      this.status.error = errText(e);
      this.onStatus();
      return null;
    }
  }

  // Tree entries for the doc's images its text links to (one unlinked since stays out of git).
  #linkedImages() {
    const d = this.doc;
    return Object.entries(d.images ?? {})
      .filter(([src]) => d.text.includes(src))
      .map(([src, sha]) => ({ path: this.#repoPath(src), mode: "100644", type: "blob", sha }));
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
      // a draft that merged its base branch into the doc: that merge isn't in git yet, even if the text is unchanged
      const merge = d.base && d.base.inGit !== d.base.commit ? d.base : undefined;
      if (!merge && d.text === this.#committedText()) return;
      const content = this.#crlf ? d.text.replaceAll("\n", "\r\n") : d.text;
      let baseTree = (await object<GitCommit>(this.repoName, "commits", parent)).tree.sha;
      if (merge) {
        // ponytail: a draft edits one file, so the merge takes every other file from the base; drafts touching
        // other files are refused (merge them on GitHub) until there's a per-file three-way merge here
        await this.#onlyThisFile(merge.inGit, parent);
        baseTree = (await object<GitCommit>(this.repoName, "commits", merge.commit)).tree.sha;
      }
      const tree = await post<{ sha: string }>(`/repos/${this.repoName}/git/trees`, {
        base_tree: baseTree,
        tree: [{ path: this.path, mode: "100644", type: "blob", content }, ...this.#linkedImages()],
      });
      const title = merge ? `Merge ${merge.branch} into ${this.branch} in Red Letter` : `Edit ${this.path} in Red Letter`;
      const message = `${title}\n\n${TRAILER} ${heads.join(",")}`;
      const parents = merge ? [parent, merge.commit] : [parent];
      const c = await post<{ sha: string }>(`/repos/${this.repoName}/git/commits`, { message, tree: tree.sha, parents });
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
      this.handle.change((doc) => {
        doc.git = { commit: c.sha, heads };
        if (merge) doc.base!.inGit = merge.commit;
      });
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

  // ---- drafts ----
  // Throws unless the draft branch changed nothing but this file from `from` to `to`.
  async #onlyThisFile(from: string, to: string) {
    if (from === to) return;
    const cmp: { files?: { filename: string }[] } = JSON.parse(await cachedGet(`/repos/${this.repoName}/compare/${from}...${to}`, { immutable: true }));
    const own = new Set([this.path, ...Object.keys(this.doc.images ?? {}).map((src) => this.#repoPath(src))]);
    const other = cmp.files?.find((f) => !own.has(f.filename));
    if (other) throw new Error(`this draft also changed ${other.filename}; merge it on GitHub`);
  }

  // Bring the base branch's new commits into this draft, like an agent push: the base's text is replayed at the
  // heads where the doc read as the base's last merged commit, so the draft's edits and the base's merge character
  // by character (overlaps are flagged as conflicts). Then saved as a git merge commit. The writer decides when.
  async updateFromBase() {
    await this.save();
    if (this.status.error) throw new Error(this.status.error);
    const b = this.doc.base!;
    const head = (this.status.baseHead = await headOf(this.repoName, b.branch, true));
    if (head === b.commit) return;
    await this.#onlyThisFile(b.inGit, this.doc.git!.commit);
    const c = await object<GitCommit>(this.repoName, "commits", head);
    const heads = await this.#replay(c, b.commit, b.heads, `Changes on ${b.branch}`);
    this.handle.change((d) => {
      d.base!.commit = head;
      d.base!.heads = [...heads]; // unchanged when the base didn't touch this file: then it's the doc's own array
    });
    await this.save();
    if (this.status.error) throw new Error(this.status.error);
  }

  // Land the draft: a merge commit on the base branch with the draft's tree; the draft branch and its snapshot are
  // deleted in the same atomic update, which fails if anyone moved either branch meanwhile. Tabs on the base see
  // the merge as an external push and replay it. false: the base had moved, its changes are now merged into the
  // draft for review, and merging again lands exactly what was reviewed.
  async mergeIntoBase(): Promise<boolean> {
    const before = this.doc.base!.commit;
    await this.updateFromBase();
    const b = this.doc.base!;
    if (b.commit !== before) return false;
    if (b.inGit !== b.commit || this.status.dirty) throw new Error("the draft isn't saved yet");
    const draft = this.doc.git!.commit;
    const { tree } = await object<GitCommit>(this.repoName, "commits", draft);
    const message = `Merge draft ${this.branch} into ${b.branch}`;
    const m = await post<{ sha: string }>(`/repos/${this.repoName}/git/commits`, { message, tree: tree.sha, parents: [b.commit, draft] });
    const err = await updateRefs(this.repoId, [
      { name: `refs/heads/${b.branch}`, beforeOid: b.commit, afterOid: m.sha },
      { name: `refs/heads/${this.branch}`, beforeOid: draft, afterOid: ZERO },
      { name: this.#crdtRef, beforeOid: await this.#crdtRefSha(true), afterOid: ZERO },
    ]);
    if (err) throw new Error(`merge lost a race, try again: ${err}`);
    this.log("merged into", b.branch, m.sha.slice(0, 7));
    return true;
  }
}
