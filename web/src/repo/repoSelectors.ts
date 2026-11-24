import type { UserRepo } from "./repoService.ts";

export type Dir = { dirs: Record<string, Dir>; files: string[] };

export function selectTree(docs: string[]): Dir {
  const root: Dir = { dirs: {}, files: [] };
  for (const p of docs) {
    let d = root;
    for (const s of p.split("/").slice(0, -1)) d = d.dirs[s] ??= { dirs: {}, files: [] };
    d.files.push(p);
  }
  return root;
}

export const selectMatches = (docs: string[], query: string) => {
  const q = query.trim().toLowerCase();
  return q ? docs.filter((p) => p.toLowerCase().includes(q)).slice(0, 200) : [];
};

// The landing page's lists: repos opened in this browser (last opened first), then 5 others the user can reach (last
// pushed first); a query filters both by name or description and widens the others to 20.
// An opened repo the user's list lacks (someone else's public repo, past the first 100) shows by name only.
export function selectHomeRepos(recent: string[], repos: UserRepo[], query: string) {
  const byName = new Map(repos.map((r) => [r.full_name.toLowerCase(), r]));
  const opened = recent.map((full) => byName.get(full.toLowerCase()) ?? { full_name: full, description: null, private: false, pushed_at: "" });
  const seen = new Set(recent.map((full) => full.toLowerCase()));
  const q = query.trim().toLowerCase();
  const hit = (r: UserRepo) => !q || r.full_name.toLowerCase().includes(q) || !!r.description?.toLowerCase().includes(q);
  return { opened: opened.filter(hit), others: repos.filter((r) => !seen.has(r.full_name.toLowerCase()) && hit(r)).slice(0, q ? 20 : 5) };
}

// Where a drag-and-drop move would put `src` (a path, or a folder "dir/") dropped into folder `dir` ("" the root):
// the new path, or null when it stays put or would go inside itself
export function selectMoveTarget(src: string, dir: string): string | null {
  const name = src.slice(src.slice(0, -1).lastIndexOf("/") + 1); // "x.md" or "folder/"
  if (src.slice(0, -name.length) === dir || (src.endsWith("/") && dir.startsWith(src))) return null;
  return dir + name;
}

// Every folder the branch's files are in ("a/", "a/b/"), sorted: the "Move to" list
export function selectFolders(docs: string[]): string[] {
  const dirs = new Set<string>();
  for (const p of docs) {
    const parts = p.split("/").slice(0, -1);
    parts.forEach((_, i) => dirs.add(`${parts.slice(0, i + 1).join("/")}/`));
  }
  return [...dirs].sort((a, b) => a.localeCompare(b));
}
