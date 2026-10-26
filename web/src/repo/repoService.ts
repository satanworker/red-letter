// GitHub calls for opening a repo, forking draft branches and a file's history. Stateless. cachedGet keeps copies,
// so a repo opened before also opens offline.
import { HttpError, cachedGet, encPath, ghJson, post, type User } from "../github.ts";

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

export async function branchHead(repo: string, branch: string): Promise<string> {
  const ref: { object: { sha: string } } = JSON.parse(await cachedGet(`/repos/${repo}/git/ref/heads/${encPath(branch)}`));
  return ref.object.sha;
}

export type Commit = { sha: string; message: string; author: string; date: string; merge: boolean };

// The commits that touched `path`, newest first, as of `commit` (a sha: the answer never changes, so it's cached for good).
// ponytail: last 50 only
export async function fileHistory(repo: string, commit: string, path: string): Promise<Commit[]> {
  type C = { sha: string; parents: unknown[]; author: { login: string } | null; commit: { message: string; author: { name: string; date: string } } };
  const list: C[] = JSON.parse(await cachedGet(`/repos/${repo}/commits?sha=${commit}&path=${encodeURIComponent(path)}&per_page=50`, { immutable: true }));
  return list.map((c) => ({ sha: c.sha, message: c.commit.message.split("\n")[0], author: c.author?.login ?? c.commit.author.name, date: c.commit.author.date, merge: c.parents.length > 1 }));
}

export async function createBranch(repo: string, branch: string, sha: string): Promise<void> {
  await post(`/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha });
}

export async function listDrafts(repo: string): Promise<string[]> {
  const refs: { ref: string }[] = JSON.parse(await cachedGet(`/repos/${repo}/git/matching-refs/heads/drafts/`));
  return refs.map((r) => r.ref.slice("refs/heads/".length));
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
  return people.map(({ login, avatar_url }) => ({ login, avatar_url }));
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
