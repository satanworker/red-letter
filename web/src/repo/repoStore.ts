// Which screen is showing, and the open repo + branch: info, the branch's markdown files, the current path.
// openRoute is the one entry point: page load, links, back/forward (see main.tsx).
import { createStore } from "solid-js/store";
import { commentsHead } from "../comments/commentsService.ts";
import { warmComments } from "../comments/commentsStore.ts";
import { closeFile, doc, noteDraft, openFile, runDraft } from "../doc/docStore.ts";
import { NO_SNAPSHOT, snapshotHeads, snapshotRef, syncCopy } from "../doc/session.ts";
import { HttpError, authKind, completeSignIn, currentUser, token, type User } from "../github.ts";
import { appInstalledOn, blobUrl, branchHead, createBranch, getRepo, listDocs, listDrafts, resolveBranch, type RepoInfo } from "./repoService.ts";

type Screen = "loading" | "landing" | "signin" | "noaccess" | "workspace" | "error";
type RepoState = {
  screen: Screen;
  message: string;
  user: User | null;
  owner: string;
  name: string;
  repo: RepoInfo | null;
  branch: string;
  docs: string[];
  path: string;
  drafts: string[]; // draft branches of the repo (drafts/<login>/<name>)
  filesHidden: boolean;
};

const [state, set] = createStore<RepoState>({
  screen: "loading",
  message: "",
  user: null,
  owner: "",
  name: "",
  repo: null,
  branch: "",
  docs: [],
  path: "",
  drafts: [],
  filesHidden: localStorage.getItem("rl_files") === "hidden" || innerWidth < 900,
});
export const repo = state;

export function toggleFiles() {
  set("filesHidden", (h) => !h);
  localStorage.setItem("rl_files", state.filesHidden ? "hidden" : "shown");
}

// Without the Navigation API (older browsers) this is a page load, which works too.
export function navigateTo(path: string) {
  if (window.navigation) void window.navigation.navigate(path);
  else location.assign(path);
}

// Paths created in this tab and not opened yet: openRoute creates them instead of loading them.
const creating = new Set<string>();

// New markdown file in the current branch. Optimistic: it joins the file list and opens at once; the file is
// committed in the background. Returns an error message for an unusable path.
export function createFile(input: string): string | null {
  let path = input.trim().replace(/^\/+/, "").replace(/\/{2,}/g, "/");
  if (!path || path.endsWith("/")) return "Type a file name";
  if (path.split("/").some((s) => s === "." || s === "..")) return "No . or .. in the path";
  if (!/\.(md|markdown|mdx|txt)$/i.test(path)) path += ".md";
  if (!state.repo) return "No repository open";
  if (!state.docs.includes(path)) {
    creating.add(path);
    set("docs", [...state.docs, path]);
  }
  navigateTo(blobUrl(state.repo.full_name, state.branch, path));
  return null;
}

// Branches forked in this tab and not opened yet: openRoute opens them as drafts of the branch they came from.
const drafting = new Map<string, string>();

// A draft of the open file on its own branch, drafts/<login>/<name>, forked where the doc was last saved (unsaved
// text is saved first, so the draft starts from what's on screen). It opens at once.
export async function createDraft(name: string) {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  const s = doc.session;
  if (!slug || !s || !state.repo || !state.user) return;
  noteDraft("Starting the draft…");
  await s.save();
  if (s.status.dirty || s.status.error) return noteDraft(`Couldn't save the text first: ${s.status.error ?? "try again"}`);
  const branch = `drafts/${state.user.login}/${slug}`;
  try {
    await createBranch(state.repo.full_name, branch, s.doc.git!.commit);
  } catch (e) {
    return noteDraft(e instanceof HttpError && e.status === 422 ? `There's already a draft called ${slug}` : String(e));
  }
  drafting.set(branch, state.branch);
  set("drafts", [...state.drafts, branch]);
  navigateTo(blobUrl(state.repo.full_name, branch, state.path));
}

// Land the open draft on its base branch and go there; the merge shows up there as a change to review.
export async function mergeDraft() {
  const base = doc.session?.doc.base?.branch;
  const merged = await runDraft("Merging…", (s) => s.mergeIntoBase());
  if (merged === false) noteDraft(`${base} had new edits: they're merged into the draft now. Review them, then merge again.`);
  if (!merged || !base || !state.repo) return;
  set("drafts", state.drafts.filter((b) => b !== state.branch));
  navigateTo(blobUrl(state.repo.full_name, base, state.path));
}

let current = 0;

// /owner/repo · /owner/repo/tree/<branch> · /owner/repo/blob/<branch>/<path> · /owner/repo/<path> (default branch)
export async function openRoute(url: URL): Promise<void> {
  const id = ++current;
  const stale = () => id !== current; // a newer navigation took over
  try {
    if (url.pathname === "/auth/callback") {
      const back = await completeSignIn();
      history.replaceState(null, "", back);
      return openRoute(new URL(back, location.origin));
    }
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (parts.length < 2) {
      closeFile();
      const user = await currentUser().catch(() => null);
      if (!stale()) set({ screen: "landing", user, repo: null });
      return;
    }
    const [owner, name, ...rest] = parts;
    if (!(await token())) {
      closeFile();
      set({ screen: "signin", owner, name, message: parts.at(-1)!, repo: null });
      return;
    }
    // same repo: keep the screen, the file list and the user; only the file changes
    const same = state.screen === "workspace" && state.repo?.full_name.toLowerCase() === `${owner}/${name}`.toLowerCase();
    let info = same ? state.repo : null;
    if (!info) {
      closeFile();
      set({ screen: "loading", message: `Opening ${rest.at(-1) ?? `${owner}/${name}`}…` });
      info = await getRepo(owner, name);
      // public repos read fine without the App, so only check where the user could write
      if (info && authKind() === "app" && info.permissions?.push && !(await appInstalledOn(info.full_name))) info = null;
      if (stale()) return;
      if (!info) {
        set({ screen: "noaccess", owner, name, repo: null });
        return;
      }
    }
    const full = info.full_name;
    let branch = info.default_branch;
    let path = rest.join("/");
    if (rest[0] === "blob" || rest[0] === "tree") {
      const tail = rest.slice(1).join("/");
      branch = same && tail.startsWith(`${state.branch}/`) ? state.branch : await resolveBranch(full, rest.slice(1), rest[0] === "tree");
      path = rest.slice(1 + branch.split("/").length).join("/");
    }
    const fresh = !(same && branch === state.branch); // another repo or branch: sync its files in the background
    const docs = fresh ? await listDocs(full, branch, true) : state.docs;
    // no file in the URL: the README (or the first document) of the branch
    path ||= docs.find((p) => /^readme\.md$/i.test(p)) ?? docs.find((p) => /(^|\/)readme\.md$/i.test(p)) ?? docs[0] ?? "";
    const user = state.user ?? (await currentUser());
    if (stale() || !user) return;
    set({ screen: "workspace", user, owner, name, repo: info, branch, docs, path, message: "" });
    if (fresh) void listDrafts(full).then((drafts) => !stale() && set("drafts", drafts), () => {});
    if (!path) {
      closeFile();
      set("message", "This branch has no markdown files yet.");
      return;
    }
    if (url.pathname !== blobUrl(full, branch, path)) history.replaceState(null, "", blobUrl(full, branch, path));
    const isNew = creating.delete(path); // created here: start it with a title instead of loading it
    const title = `# ${path.split("/").pop()!.replace(/\.[^.]+$/, "")}\n\n`;
    const draftOf = drafting.get(branch);
    drafting.delete(branch);
    if (!(await openFile(info, branch, path, user, isNew ? title : undefined, draftOf)) && !stale()) set("message", `${path} doesn't exist on ${branch}.`);
    if (fresh && !stale()) void syncAll(full, branch, docs);
  } catch (e) {
    if (!stale()) set({ screen: "error", message: e instanceof Error ? e.message : String(e) });
  }
}

let syncRun = 0;
function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

// After a repo opens: bring every doc of the branch (and its comments) into this browser, one at a time, so any
// file then opens at once. Opening a file always goes first: the loop waits while one is opening. Read-only:
// it never creates snapshots. Stops when another repo or branch opens, or when GitHub can't be reached.
async function syncAll(repo: string, branch: string, cached: string[]) {
  const run = ++syncRun;
  try {
    const [docs, heads, head, comments] = await Promise.all([listDocs(repo, branch), snapshotHeads(repo, branch), branchHead(repo, branch), commentsHead(repo)]);
    // the sidebar showed this browser's last list; files added or removed since show up now
    if (run === syncRun && docs.join("\n") !== cached.join("\n")) set("docs", docs);
    // four at a time: GitHub's latency (~400 ms per request), not bandwidth, is the limit
    const queue = docs.slice();
    const worker = async () => {
      for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
        while (doc.opening) await sleep(200);
        if (run !== syncRun) return;
        const p = path;
        const isOpen = () => doc.opening === p || doc.session?.path === p;
        if (isOpen()) continue;
        await syncCopy(repo, branch, p, heads.get(await snapshotRef(branch, p)) ?? NO_SNAPSHOT, head, isOpen);
        if (comments) await warmComments(repo, branch, p, comments);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (run !== syncRun) return;
    console.log(`[rl] synced ${docs.length} docs of ${repo}@${branch} in the background`);
  } catch (e) {
    console.warn("[rl] background sync stopped:", e);
  }
}
