// GitHub calls for opening a repo, forking draft branches and a file's history. Stateless. cachedGet keeps copies,
// so a repo opened before also opens offline.
import { HttpError, cachedGet, encPath, ghJson, post, updateRefs, type User } from "../github.ts";

export type RepoInfo = { node_id: string; full_name: string; default_branch: string; permissions?: { push: boolean } };

export const blobUrl = (repo: string, branch: string, path: string) => `/${repo}/blob/${encPath(branch)}/${encPath(path)}`;
const isDoc = (p: string) => /\.(md|markdown|mdx|txt)$/i.test(p);

// null: the user's token can't see it (GitHub answers 404 for private repos it can't see).
// Stale-first: permissions and the default branch rarely change; the copy is revalidated behind it.
export async function getRepo(owner: string, name: string): Promise<RepoInfo | null> {
  try {
    return JSON.parse(await cachedGet(`/repos/${owner}/${name}`, { stale: true }));
  } catch (e) {
    if (e instanceof HttpError && (e.status === 404 || e.status === 403)) return null;
    throw e;
  }
}

// Branch names may contain "/": the shortest prefix of `parts` that is a branch, like GitHub does.
export async function resolveBranch(repo: string, parts: string[], wholeAllowed: boolean): Promise<string> {
  for (let i = 1; i <= parts.length - (wholeAllowed ? 0 : 1); i++) {
    const cand = parts.slice(0, i).join("/");
    try {
      await cachedGet(`/repos/${repo}/git/ref/heads/${encPath(cand)}`, { stale: true });
      return cand;
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
    }
  }
  throw new Error(`No branch found in ${parts.join("/")}`);
}

export async function branchHead(repo: string, branch: string, fresh = false): Promise<string> {
  const ref: { object: { sha: string } } = JSON.parse(await cachedGet(`/repos/${repo}/git/ref/heads/${encPath(branch)}`, { fresh }));
  return ref.object.sha;
}

// Protected: no direct edits from Red Letter, even for admins who could bypass the rule (stale-first, like getRepo).
// ponytail: GitHub's `protected` flag; GraphQL refUpdateRule.viewerCanPush if bypassing admins should edit directly
export async function branchProtected(repo: string, branch: string): Promise<boolean> {
  const b: { protected: boolean } = JSON.parse(await cachedGet(`/repos/${repo}/branches/${encPath(branch)}`, { stale: true }));
  return b.protected;
}

export type Commit = { sha: string; message: string; author: string; date: string; merge: boolean };

// The commits that touched `path`, newest first, as of `commit` (a sha: the answer never changes, so it's cached for good).
// ponytail: last 50 only
export async function fileHistory(repo: string, commit: string, path: string): Promise<Commit[]> {
  type C = { sha: string; parents: unknown[]; author: { login: string } | null; commit: { message: string; author: { name: string; date: string } } };
  const list: C[] = JSON.parse(await cachedGet(`/repos/${repo}/commits?sha=${commit}&path=${encodeURIComponent(path)}&per_page=50`, { immutable: true }));
  return list.map((c) => ({ sha: c.sha, message: c.commit.message.split("\n")[0], author: c.author?.login ?? c.commit.author.name, date: c.commit.author.date, merge: c.parents.length > 1 }));
}

// What `sha` changed in `path`: GitHub's unified diff hunks ("" when it didn't touch the file, null when GitHub
// leaves the patch out: binary or too large). A merge is diffed against its first parent.
export async function commitPatch(repo: string, sha: string, path: string): Promise<string | null> {
  const c: { files?: { filename: string; patch?: string }[] } = JSON.parse(await cachedGet(`/repos/${repo}/commits/${sha}`, { immutable: true }));
  const f = c.files?.find((x) => x.filename === path);
  return f ? (f.patch ?? null) : "";
}

export async function createBranch(repo: string, branch: string, sha: string): Promise<void> {
  await post(`/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha });
}

// Every branch of the repo, for the picker. Stale-first; a branch just forked is added by the store.
// ponytail: first 100 only; page when a repo with more shows up
export async function listBranches(repo: string, fresh = false): Promise<string[]> {
  const bs: { name: string }[] = JSON.parse(await cachedGet(`/repos/${repo}/branches?per_page=100`, fresh ? { fresh: true } : { stale: true }));
  return bs.map((b) => b.name);
}

// stale: the list this browser saw last, at once (background sync refreshes it)
export async function listDocs(repo: string, branch: string, stale = false): Promise<string[]> {
  // ponytail: one recursive tree call; GitHub truncates past ~100k entries
  const t: { tree: { path: string; type: string }[] } = JSON.parse(await cachedGet(`/repos/${repo}/git/trees/${encPath(branch)}?recursive=1`, { stale }));
  return t.tree.filter((e) => e.type === "blob" && isDoc(e.path)).map((e) => e.path);
}

// People who can be @mentioned: the repo's collaborators (needs push access, as writing a comment does).
// ponytail: first 100 only
export async function listCollaborators(repo: string): Promise<User[]> {
  const people: User[] = JSON.parse(await cachedGet(`/repos/${repo}/collaborators?per_page=100`, { stale: true }));
  return people.map(({ login, avatar_url, id }) => ({ login, avatar_url, id }));
}

// A GitHub App token can only write where the App is installed. Answered from this browser's copy first (it
// revalidates behind); a "no" is rechecked with GitHub, so a fresh install is seen right away.
export async function appInstalledOn(fullName: string, stale = true): Promise<boolean> {
  const owner = fullName.split("/")[0].toLowerCase();
  type Inst = { id: number; account: { login: string }; repository_selection: "all" | "selected" };
  const { installations }: { installations: Inst[] } = JSON.parse(await cachedGet("/user/installations?per_page=100", { stale }));
  const inst = installations.find((i) => i.account.login.toLowerCase() === owner);
  let ok = inst?.repository_selection === "all";
  if (inst && !ok) {
    // ponytail: first 100 selected repos only
    const { repositories }: { repositories: { full_name: string }[] } = JSON.parse(await cachedGet(`/user/installations/${inst.id}/repositories?per_page=100`, { stale }));
    ok = repositories.some((r) => r.full_name.toLowerCase() === fullName.toLowerCase());
  }
  return ok || (stale && appInstalledOn(fullName, false));
}

export type UserRepo = { full_name: string; description: string | null; private: boolean; pushed_at: string };

// Every repo the user's token reaches (owned, collaborator, org member; a GitHub App token: where it's installed),
// last pushed first. Revalidated with the ETag on each visit, the copy offline.
// ponytail: first 100 only
export async function listUserRepos(): Promise<UserRepo[]> {
  const rs: UserRepo[] = JSON.parse(await cachedGet("/user/repos?sort=pushed&per_page=100"));
  return rs.map((r) => ({ full_name: r.full_name, description: r.description, private: r.private, pushed_at: r.pushed_at }));
}

// Moving, copying or deleting a file, or a folder ("dir/") with everything in it: the tree entries that do it as of
// commit `parent`. Moving deletes each blob and adds it at `target` + the rest of its path (same blob, no download);
// copying only adds; deleting (`target` null) only deletes. `skip` stays out: the open doc, which its Session writes
// itself (with its unsaved text). `paths` lists every blob's old path and new one (null: deleted). Throws when nothing
// is there any more or a new path is taken.
type Entry = { path: string; mode: string; type: string; sha: string };
export async function treePlan(repo: string, parent: string, src: string, target: string | null, copy = false, skip = ""): Promise<{ tree: object[]; paths: [string, string | null][] }> {
  const c: { tree: { sha: string } } = JSON.parse(await cachedGet(`/repos/${repo}/git/commits/${parent}`, { immutable: true }));
  const t: { tree: Entry[] } = JSON.parse(await cachedGet(`/repos/${repo}/git/trees/${c.tree.sha}?recursive=1`, { immutable: true }));
  const blobs = t.tree.filter((e) => e.type === "blob");
  const from = blobs.filter((e) => (src.endsWith("/") ? e.path.startsWith(src) : e.path === src));
  if (!from.length) throw new Error(`${src} isn't on this branch any more`);
  const to = (p: string) => (target === null ? null : target + p.slice(src.length));
  const paths = from.map((e): [string, string | null] => [e.path, to(e.path)]);
  const taken = new Set(blobs.map((e) => e.path));
  const clash = paths.find(([, p]) => p !== null && taken.has(p));
  if (clash) throw new Error(`${clash[1]} already exists`);
  const tree = from.filter((e) => e.path !== skip).flatMap((e) => [
    ...(copy ? [] : [{ path: e.path, mode: e.mode, type: "blob", sha: null }]),
    ...(target === null ? [] : [{ path: to(e.path), mode: e.mode, type: "blob", sha: e.sha }]),
  ]);
  return { tree, paths };
}

// One commit on `branch` from `parent` with `tree` (entries over parent's tree), and the other refs in the same atomic
// update; refused when the branch moved meanwhile.
export async function commitTree(repo: string, repoId: string, branch: string, parent: string, tree: object[], message: string, refs: { name: string; beforeOid: string; afterOid: string }[]): Promise<string> {
  const c: { tree: { sha: string } } = JSON.parse(await cachedGet(`/repos/${repo}/git/commits/${parent}`, { immutable: true }));
  const t = await post<{ sha: string }>(`/repos/${repo}/git/trees`, { base_tree: c.tree.sha, tree });
  const commit = await post<{ sha: string }>(`/repos/${repo}/git/commits`, { message, tree: t.sha, parents: [parent] });
  const err = await updateRefs(repoId, [{ name: `refs/heads/${branch}`, beforeOid: parent, afterOid: commit.sha }, ...refs]);
  if (err) throw new Error(`someone saved meanwhile, try again: ${err}`);
  return commit.sha;
}
