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

// The landing page's lists: repos opened in this browser (last opened first), then the rest the user can reach.
// An opened repo the user's list lacks (someone else's public repo, past the first 100) shows by name only.
export function selectHomeRepos(recent: string[], repos: UserRepo[]) {
  const byName = new Map(repos.map((r) => [r.full_name.toLowerCase(), r]));
  const opened = recent.map((full) => byName.get(full.toLowerCase()) ?? { full_name: full, description: null, private: false, pushed_at: "" });
  const seen = new Set(recent.map((full) => full.toLowerCase()));
  return { opened, others: repos.filter((r) => !seen.has(r.full_name.toLowerCase())) };
}
