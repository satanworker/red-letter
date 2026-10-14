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
