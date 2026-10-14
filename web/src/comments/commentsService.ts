// Comments live in the repo, on the orphan branch `red-letter-comments`, one JSON array per file:
//   <branch>/<path>.json
// so agents can read them: git fetch origin red-letter-comments && git show FETCH_HEAD:main/docs/x.md.json
// Anchors are Automerge cursors into this file's doc; `quote` re-anchors by text if the doc identity changes.
import { HttpError, cachedGet, gh, post, unb64 } from "../github.ts";

export type Comment = {
  id: string;
  parent?: string; // replies point at the root comment
  author: string;
  body: string;
  createdAt: string;
  resolved?: boolean;
  docId?: string;
  from?: string;
  to?: string;
  quote?: string;
};

const BRANCH = "red-letter-comments";

// The comments branch head; null while nobody has commented in this repo yet.
// fresh: for the compare-and-swap write; reads share one recent answer with background sync.
export async function commentsHead(repoName: string, fresh = false): Promise<string | null> {
  try {
    const ref: { object: { sha: string } } = JSON.parse(await cachedGet(`/repos/${repoName}/git/ref/heads/${BRANCH}`, { fresh }));
    return ref.object.sha;
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
}

export class Comments {
  list: Comment[] = [];
  // Heads this tab has already seen or written. The branch only moves forward, so getting one of these back
  // means a lagging read: ignore it instead of showing an older list (a just-posted comment would vanish).
  #seen = new Set<string>();
  readonly file: string;

  constructor(
    readonly repoName: string,
    branch: string,
    path: string,
  ) {
    // ponytail: branch "a" + path "b/c.md" and branch "a/b" + path "c.md" share a file; hash the key if it ever matters
    this.file = `${branch}/${path}.json`;
  }

  // Through the branch's tree: one tree per head serves every file, and a file's blob only changes when its
  // comments do. Both are addressed by sha, so they are fetched once and then come from the browser's copy.
  async #read(head: string): Promise<Comment[]> {
    const tree: { tree: { path: string; sha: string }[] } = JSON.parse(await cachedGet(`/repos/${this.repoName}/git/trees/${head}?recursive=1`, { immutable: true }));
    const entry = tree.tree.find((e) => e.path === this.file);
    if (!entry) return [];
    const blob: { content: string } = JSON.parse(await cachedGet(`/repos/${this.repoName}/git/blobs/${entry.sha}`, { immutable: true }));
    return JSON.parse(new TextDecoder().decode(unb64(blob.content)));
  }

  // Returns true when the list changed.
  async refresh(): Promise<boolean> {
    const head = await commentsHead(this.repoName);
    if (!head || this.#seen.has(head)) return false;
    await this.loadAt(head);
    return true;
  }

  // The list as of a known head: background sync looks the head up once for every file.
  async loadAt(head: string) {
    this.#seen.add(head);
    this.list = await this.#read(head);
  }

  // Read-modify-write with CAS on the branch; retries when someone else commented meanwhile.
  async mutate(message: string, fn: (list: Comment[]) => Comment[]) {
    for (let attempt = 1; ; attempt++) {
      const head = await commentsHead(this.repoName, true);
      if (head) this.#seen.add(head);
      const next = fn(head ? await this.#read(head) : []);
      const parent: { tree: { sha: string } } | null = head ? JSON.parse(await cachedGet(`/repos/${this.repoName}/git/commits/${head}`, { immutable: true })) : null;
      const baseTree = parent?.tree.sha;
      const tree = await post<{ sha: string }>(`/repos/${this.repoName}/git/trees`, {
        ...(baseTree ? { base_tree: baseTree } : {}),
        tree: [{ path: this.file, mode: "100644", type: "blob", content: JSON.stringify(next, null, 2) + "\n" }],
      });
      const c = await post<{ sha: string }>(`/repos/${this.repoName}/git/commits`, { message, tree: tree.sha, parents: head ? [head] : [] });
      const res = head
        ? await gh(`/repos/${this.repoName}/git/refs/heads/${BRANCH}`, { method: "PATCH", body: JSON.stringify({ sha: c.sha, force: false }) })
        : await gh(`/repos/${this.repoName}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: c.sha }) });
      if (res.ok) {
        this.#seen.add(c.sha);
        this.list = next;
        return;
      }
      if (res.status !== 422 || attempt >= 4) throw new HttpError(res.status, `saving comment: ${res.status} ${await res.text()}`);
    }
  }
}
