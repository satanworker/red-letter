// GitHub reads for opening a repo. Stateless. cachedGet keeps copies, so a repo opened before also opens offline.
import { HttpError, cachedGet, encPath, ghJson } from "../github.ts";

export type RepoInfo = { node_id: string; full_name: string; default_branch: string; permissions?: { push: boolean } };

export const blobUrl = (repo: string, branch: string, path: string) => `/${repo}/blob/${encPath(branch)}/${encPath(path)}`;
const isDoc = (p: string) => /\.(md|markdown|mdx|txt)$/i.test(p);

// null: the user's token can't see it (GitHub answers 404 for private repos it can't see)
export async function getRepo(owner: string, name: string): Promise<RepoInfo | null> {
  try {
    return JSON.parse(await cachedGet(`/repos/${owner}/${name}`));
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
      await cachedGet(`/repos/${repo}/git/ref/heads/${encPath(cand)}`);
      return cand;
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
    }
  }
  throw new Error(`No branch found in ${parts.join("/")}`);
}

export async function listDocs(repo: string, branch: string): Promise<string[]> {
  // ponytail: one recursive tree call; GitHub truncates past ~100k entries
  const t: { tree: { path: string; type: string }[] } = JSON.parse(await cachedGet(`/repos/${repo}/git/trees/${encPath(branch)}?recursive=1`));
  return t.tree.filter((e) => e.type === "blob" && isDoc(e.path)).map((e) => e.path);
}

// A GitHub App token can only write where the App is installed.
export async function appInstalledOn(fullName: string): Promise<boolean> {
  const owner = fullName.split("/")[0].toLowerCase();
  type Inst = { id: number; account: { login: string }; repository_selection: "all" | "selected" };
  const { installations } = await ghJson<{ installations: Inst[] }>("/user/installations?per_page=100");
  const inst = installations.find((i) => i.account.login.toLowerCase() === owner);
  if (!inst) return false;
  if (inst.repository_selection === "all") return true;
  // ponytail: first 100 selected repos only
  const { repositories } = await ghJson<{ repositories: { full_name: string }[] }>(`/user/installations/${inst.id}/repositories?per_page=100`);
  return repositories.some((r) => r.full_name.toLowerCase() === fullName.toLowerCase());
}
