// Comments live in the repo, on the orphan branch `red-letter-comments`, one JSON array per file:
//   <branch>/<path>.json
// so agents can read them: git fetch origin red-letter-comments && git show FETCH_HEAD:main/docs/x.md.json
// Anchors are Automerge cursors into this file's doc; `quote` re-anchors by text if the doc identity changes.
import { HttpError, encPath, gh, ghJson, post } from "./github.ts";

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

export class Comments {
  list: Comment[] = [];
  #etag = "";
  #head = "";
  readonly file: string;

  constructor(
    readonly repoName: string,
    branch: string,
    path: string,
  ) {
    // ponytail: branch "a" + path "b/c.md" and branch "a/b" + path "c.md" share a file; hash the key if it ever matters
    this.file = `${branch}/${path}.json`;
  }

  async #headSha(): Promise<string | null> {
    const res = await gh(`/repos/${this.repoName}/git/ref/heads/${BRANCH}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new HttpError(res.status, `comments branch: ${res.status}`);
    const ref: { object: { sha: string } } = await res.json();
    return ref.object.sha;
  }

  async #read(sha: string): Promise<Comment[]> {
    const res = await gh(`/repos/${this.repoName}/contents/${encPath(this.file)}?ref=${sha}`, { raw: true });
    if (res.status === 404) return [];
    if (!res.ok) throw new HttpError(res.status, `comments: ${res.status}`);
    return res.json();
  }

  // Returns true when the list changed.
  async refresh(): Promise<boolean> {
    const res = await gh(`/repos/${this.repoName}/git/ref/heads/${BRANCH}`, { headers: this.#etag ? { "if-none-match": this.#etag } : {} });
    if (res.status === 304 || res.status === 404) return false;
    if (!res.ok) throw new HttpError(res.status, `comments branch: ${res.status}`);
    this.#etag = res.headers.get("etag") ?? "";
    const ref: { object: { sha: string } } = await res.json();
    if (ref.object.sha === this.#head) return false;
    this.#head = ref.object.sha;
    this.list = await this.#read(this.#head);
    return true;
  }

  // Read-modify-write with CAS on the branch; retries when someone else commented meanwhile.
  async mutate(message: string, fn: (list: Comment[]) => Comment[]) {
    for (let attempt = 1; ; attempt++) {
      const head = await this.#headSha();
      const next = fn(head ? await this.#read(head) : []);
      const baseTree = head ? (await ghJson<{ tree: { sha: string } }>(`/repos/${this.repoName}/git/commits/${head}`)).tree.sha : undefined;
      const tree = await post<{ sha: string }>(`/repos/${this.repoName}/git/trees`, {
        ...(baseTree ? { base_tree: baseTree } : {}),
        tree: [{ path: this.file, mode: "100644", type: "blob", content: JSON.stringify(next, null, 2) + "\n" }],
      });
      const c = await post<{ sha: string }>(`/repos/${this.repoName}/git/commits`, { message, tree: tree.sha, parents: head ? [head] : [] });
      const res = head
        ? await gh(`/repos/${this.repoName}/git/refs/heads/${BRANCH}`, { method: "PATCH", body: JSON.stringify({ sha: c.sha, force: false }) })
        : await gh(`/repos/${this.repoName}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: c.sha }) });
      if (res.ok) {
        this.#head = c.sha;
        this.list = next;
        return;
      }
      if (res.status !== 422 || attempt >= 4) throw new HttpError(res.status, `saving comment: ${res.status} ${await res.text()}`);
    }
  }
}
