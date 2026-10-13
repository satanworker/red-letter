// One open file: CRDT doc <-> git. Snapshot ref load/claim, poll + deterministic replay of agent commits,
// CAS commit of file + snapshot, agent-change and conflict marks stored in the doc.
import * as A from "@automerge/automerge";
import { Repo, type DocHandle, type DocumentId, type PeerId } from "@automerge/automerge-repo";
import { HUB, HttpError, b64, encPath, gh, ghJson, post, sha1, token, unb64, updateRefs } from "./github.ts";
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
type GitCommit = { sha: string; parents: { sha: string }[]; message: string; author: { name: string; date: string }; tree: { sha: string } };

const TRAILER = "Red-Letter-Heads:";
const ZERO = "0".repeat(40);
const lf = (s: string) => s.replaceAll("\r\n", "\n");

export type Status = { saving: boolean; dirty: boolean; error?: string; commit: string; peers: number; online: boolean };

export class Session {
  handle!: DocHandle<RLDoc>;
  status: Status = { saving: false, dirty: false, commit: "", peers: 0, online: false };
  onStatus: () => void = () => {};
  log: (...a: unknown[]) => void = (...a) => console.log("[rl]", ...a);

  #repo: Repo;
  #hub?: HubAdapter;
  #crdtRef = "";
  #crdtHead = ZERO;
  #crlf = false;
  #etag = "";
  #polling?: Promise<void>;
  #saving?: Promise<void>;
  #autosave: number | undefined;

  constructor(
    readonly repoName: string,
    readonly repoId: string,
    readonly branch: string,
    readonly path: string,
    readonly canWrite: boolean,
    login: string,
  ) {
    const peerId = `${login}-${crypto.randomUUID().slice(0, 8)}` as PeerId;
    if (canWrite) {
      this.#hub = new HubAdapter(`${HUB.replace(/^http/, "ws")}/sync?repo=${encodeURIComponent(repoName)}`, token);
      this.#hub.onStatus = (s) => {
        Object.assign(this.status, { online: s.connected, peers: s.peers });
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
    const res = await gh(`/repos/${this.repoName}/contents/${encPath(this.path)}?ref=${sha}`, { raw: true });
    if (!res.ok) throw new HttpError(res.status, `${this.path} not found at ${sha.slice(0, 7)} (${res.status})`);
    const text = await res.text();
    this.#crlf = text.includes("\r\n");
    return lf(text);
  }

  async #headSha(): Promise<string> {
    return (await ghJson<{ object: { sha: string } }>(`/repos/${this.repoName}/git/ref/heads/${encPath(this.branch)}`)).object.sha;
  }

  async #crdtRefSha(): Promise<string> {
    const res = await gh(`/repos/${this.repoName}/git/ref/${this.#crdtRef.slice("refs/".length)}`);
    if (res.status === 404) return ZERO;
    if (!res.ok) throw new HttpError(res.status, `snapshot ref: ${res.status}`);
    const ref: { object: { sha: string } } = await res.json();
    return ref.object.sha;
  }

  async #readSnapshot(sha: string): Promise<{ meta: Meta; bytes: Uint8Array }> {
    const c = await ghJson<GitCommit>(`/repos/${this.repoName}/git/commits/${sha}`);
    const tree = await ghJson<{ tree: { path: string; sha: string }[] }>(`/repos/${this.repoName}/git/trees/${c.tree.sha}`);
    const blob = async (name: string) =>
      unb64((await ghJson<{ content: string }>(`/repos/${this.repoName}/git/blobs/${tree.tree.find((e) => e.path === name)!.sha}`)).content);
    const meta: Meta = JSON.parse(new TextDecoder().decode(await blob("meta.json")));
    if ((meta.replayVersion ?? 1) > REPLAY_VERSION) throw new Error("This file was saved by a newer Red Letter. Reload the page.");
    return { meta, bytes: await blob("doc.automerge") };
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

  async open() {
    this.#crdtRef = `refs/red-letter/v1/${await sha1(this.branch)}/${await sha1(this.path)}`;
    this.#crdtHead = await this.#crdtRefSha();
    if (this.#crdtHead !== ZERO) {
      const snap = await this.#readSnapshot(this.#crdtHead);
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
          this.#crdtHead = await this.#crdtRefSha();
          const theirs = await this.#readSnapshot(this.#crdtHead);
          this.handle = this.#repo.import<RLDoc>(theirs.bytes, { docId: theirs.meta.docId as DocumentId });
        } else if (!res.ok) throw new HttpError(res.status, `claim snapshot ref: ${res.status} ${await res.text()}`);
        else this.#crdtHead = snap;
      }
    }
    this.status.commit = this.doc.git!.commit;
    this.handle.on("change", () => {
      this.status.commit = this.doc.git!.commit;
      this.#markDirty();
      // any tab with unsaved text (its own or peers') saves 30-40 s after the last change; the first save wins,
      // the others find nothing left to commit
      if (this.status.dirty) this.#scheduleAutosave();
    });
    await this.poll();
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
  poll(): Promise<void> {
    return (this.#polling ??= this.#poll().finally(() => (this.#polling = undefined)));
  }

  async #poll() {
    try {
      const res = await gh(`/repos/${this.repoName}/git/ref/heads/${encPath(this.branch)}`, {
        headers: this.#etag ? { "if-none-match": this.#etag } : {},
      });
      if (res.status === 304) return;
      if (!res.ok) throw new HttpError(res.status, `branch ${this.branch}: ${res.status}`);
      this.#etag = res.headers.get("etag") ?? "";
      const ref: { object: { sha: string } } = await res.json();
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
        const c = await ghJson<GitCommit>(`/repos/${this.repoName}/git/commits/${sha}`);
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
            this.#crdtHead = await this.#crdtRefSha();
            const snap = await this.#readSnapshot(this.#crdtHead);
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
      this.status.error = undefined;
    } catch (e) {
      this.status.error = String(e instanceof Error ? e.message : e);
    } finally {
      this.status.commit = this.doc.git!.commit; // a peer may have advanced it via sync
      this.#markDirty();
      this.onStatus();
    }
  }

  async #replay(c: GitCommit, from: string, heads: A.Heads): Promise<A.Heads> {
    const blob = await this.#file(c.sha);
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
      await this.poll(); // build on the newest head we can see
      const d = this.doc;
      const heads = A.getHeads(d);
      const parent = d.git!.commit;
      if (d.text === this.#committedText()) return;
      const content = this.#crlf ? d.text.replaceAll("\n", "\r\n") : d.text;
      const pc = await ghJson<GitCommit>(`/repos/${this.repoName}/git/commits/${parent}`);
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
        this.#crdtHead = await this.#crdtRefSha();
        return this.#save(attempt + 1);
      }
      this.#crdtHead = snap;
      this.handle.change((doc) => (doc.git = { commit: c.sha, heads }));
      this.status.commit = c.sha;
      this.status.error = undefined;
      this.log("saved", c.sha.slice(0, 7));
    } catch (e) {
      this.status.error = String(e instanceof Error ? e.message : e);
    } finally {
      this.status.saving = false;
      this.#markDirty();
      this.onStatus();
    }
  }
}
