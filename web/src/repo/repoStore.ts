// Which screen is showing, and the open repo + branch: info, the branch's markdown files, the current path.
// openRoute is the one entry point: page load, links, back/forward (see main.tsx).
import { createStore } from "solid-js/store";
import { clearIcons, clearReview, closeFile, doc, noteDraft, noteIcon, openFile, refreshPr, runDraft } from "../doc/docStore.ts";
import { refreshComments } from "../comments/commentsStore.ts";
import { loadPulls, refreshPulls, setReviewing } from "../pulls/pullsStore.ts";
import { NO_SNAPSHOT, snapshotHeads, snapshotRef, syncCopy, type Session } from "../doc/session.ts";
import { HttpError, authKind, completeSignIn, currentUser, encPath, token, type User } from "../github.ts";
import { approvePr, closePr, mergeInto, mergePr, openPr, openPrFrom, requestChanges, reviewBranch, touchFile, type Pr } from "./pulls.ts";
import { appInstalledOn, blobUrl, branchHead, createBranch, getRepo, listBranches, listCollaborators, listDocs, resolveBranch, type RepoInfo } from "./repoService.ts";

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
  tabs: string[]; // open files of this repo + branch, in tab order; the route's file is always one of them
  branches: string[]; // every branch of the repo, for the picker
  filesHidden: boolean;
  panelHidden: boolean; // the comments / history panel
  collaborators: User[]; // who can be @mentioned, loaded on first use
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
  tabs: [],
  branches: [],
  filesHidden: localStorage.getItem("rl_files") === "hidden" || innerWidth < 900,
  panelHidden: localStorage.getItem("rl_panel") === "hidden",
  collaborators: [],
});
export const repo = state;
// The /__figma dev page sets the whole workspace from fixture data (src/dev/figma.tsx).
export const fixtureRepo = (s: Partial<RepoState>) => set(s);

export function toggleFiles() {
  set("filesHidden", (h) => !h);
  localStorage.setItem("rl_files", state.filesHidden ? "hidden" : "shown");
}

export function togglePanel() {
  set("panelHidden", (h) => !h);
  localStorage.setItem("rl_panel", state.panelHidden ? "hidden" : "shown");
}
// opening a thread or a panel tab from elsewhere (the doc, the palette) brings the panel back
export const showPanel = () => state.panelHidden && togglePanel();

let collaboratorsOf = "";
// Once per repo, when someone first types "@".
export function loadCollaborators() {
  const name = state.repo?.full_name;
  if (!name || collaboratorsOf === name) return;
  collaboratorsOf = name;
  listCollaborators(name).then(
    (people) => state.repo?.full_name === name && set("collaborators", people),
    () => (collaboratorsOf = ""), // retry on the next "@"
  );
}

// Without the Navigation API (older browsers) this is a page load, which works too.
// newTab: the file gets a tab of its own instead of replacing the open tab's (⌘/Ctrl+click, "+").
export function navigateTo(path: string, newTab = false) {
  if (window.navigation) void window.navigation.navigate(path, { info: { newTab } });
  else location.assign(path);
}

// Tabs are per repo + branch, kept across reloads. Opening a file that has a tab goes to it; otherwise the file replaces
// the open tab's, or with newTab gets a new tab right after it.
const tabsKey = (full: string, branch: string) => `rl_tabs:${full}@${branch}`;
function setTabs(tabs: string[]) {
  set("tabs", tabs);
  localStorage.setItem(tabsKey(state.repo!.full_name, state.branch), JSON.stringify(tabs));
}

// ⌘/Ctrl+click, as in Chrome: a file of this branch gets a tab right after the open one and stays in the background.
// A link anywhere else (another branch or repo) opens there in a new tab.
export function openInBackground(pathname: string) {
  const prefix = blobUrl(state.repo!.full_name, state.branch, "");
  const path = pathname.startsWith(prefix) ? decodeURIComponent(pathname.slice(prefix.length)) : "";
  if (!state.docs.includes(path)) return navigateTo(pathname, true);
  if (!state.tabs.includes(path)) setTabs(state.tabs.toSpliced(state.tabs.indexOf(state.path) + 1, 0, path));
}

// Closing the open tab opens its right neighbour, else its left one. The last tab stays: the route always names a file.
export function closeTab(path: string) {
  const i = state.tabs.indexOf(path);
  if (i < 0 || state.tabs.length < 2) return;
  const tabs = state.tabs.filter((p) => p !== path);
  setTabs(tabs);
  if (path === state.path) navigateTo(blobUrl(state.repo!.full_name, state.branch, tabs[Math.min(i, tabs.length - 1)]!));
}

// Paths created in this tab and not opened yet, with their starting text: openRoute creates them instead of loading them.
const creating = new Map<string, string>();

// A path as typed, ".md" added when it has no markdown extension; or why it can't be one.
function docPath(input: string): { path: string } | { error: string } {
  const path = input.trim().replace(/^\/+/, "").replace(/\/{2,}/g, "/");
  if (!path || path.endsWith("/")) return { error: "Type a file name" };
  if (path.split("/").some((s) => s === "." || s === "..")) return { error: "No . or .. in the path" };
  return { path: /\.(md|markdown|mdx|txt)$/i.test(path) ? path : `${path}.md` };
}

// New markdown file in the current branch. Optimistic: it joins the file list and opens at once; the file is
// committed in the background. Returns an error message for an unusable path.
export function createFile(input: string): string | null {
  const p = docPath(input);
  if ("error" in p) return p.error;
  if (!state.repo) return "No repository open";
  if (!state.docs.includes(p.path)) {
    creating.set(p.path, `# ${p.path.split("/").pop()!.replace(/\.[^.]+$/, "")}\n\n`);
    set("docs", [...state.docs, p.path]);
  }
  navigateTo(blobUrl(state.repo.full_name, state.branch, p.path));
  return null;
}

// A copy of the open file next to it ("x copy.md", "x copy 2.md", …), opened in a tab right after it.
export function duplicateFile() {
  const s = doc.session;
  if (!s || !state.repo) return;
  const [, stem, ext = ""] = /^(.*?)(\.[^./]+)?$/.exec(s.path)!;
  let path = `${stem} copy${ext}`;
  for (let n = 2; state.docs.includes(path); n++) path = `${stem} copy ${n}${ext}`;
  creating.set(path, s.doc.text);
  set("docs", [...state.docs, path]);
  navigateTo(blobUrl(state.repo.full_name, state.branch, path), true);
}

// Move the open file to another path (its tab follows), or delete it (its tab closes; the next one opens). Both are
// one commit; progress and errors show over the doc.
export async function moveFile(input: string) {
  const s = doc.session;
  const p = docPath(input);
  if (!s || !state.repo) return;
  if ("error" in p) return noteDraft(p.error);
  if (p.path === s.path) return;
  if (state.docs.includes(p.path)) return noteDraft(`${p.path} already exists`);
  if (!(await removeFile(s, `Moving to ${p.path}…`, p.path))) return;
  set("docs", state.docs.map((d) => (d === s.path ? p.path : d)));
  setTabs(state.tabs.map((t) => (t === s.path ? p.path : t)));
  navigateTo(blobUrl(state.repo.full_name, state.branch, p.path));
}

export async function deleteFile() {
  const s = doc.session;
  if (!s || !state.repo || !(await removeFile(s, `Deleting ${s.path}…`))) return;
  const i = state.tabs.indexOf(s.path);
  const tabs = state.tabs.filter((t) => t !== s.path);
  set("docs", state.docs.filter((d) => d !== s.path));
  setTabs(tabs);
  const next = tabs[Math.min(i, tabs.length - 1)];
  // no tab left: the branch's README or first doc
  navigateTo(next ? blobUrl(state.repo.full_name, state.branch, next) : `/${state.repo.full_name}/tree/${encPath(state.branch)}`);
}

async function removeFile(s: Session, busy: string, to?: string): Promise<boolean> {
  noteDraft(busy);
  try {
    await s.remove(to);
    return true;
  } catch (e) {
    noteDraft(e instanceof Error ? e.message : String(e));
    return false;
  }
}

// Branches forked in this tab and not opened yet: openRoute opens them with the branch they came from as base.
const drafting = new Map<string, string>();

// A git branch name from what the user typed: each segment lowercased, odd characters to "-", empty segments dropped.
const branchName = (input: string) =>
  input
    .split("/")
    .map((seg) => seg.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, ""))
    .filter(Boolean)
    .join("/");

// The open file on a new branch `name`, forked where the doc was last saved (unsaved text is saved first, so the
// branch starts from what's on screen). It opens at once, with this branch as its base.
export async function forkBranch(name: string) {
  const branch = branchName(name);
  const s = doc.session;
  if (!branch || !s || !state.repo || !state.user) return;
  noteDraft("Creating the branch…");
  await s.save();
  if (s.status.dirty || s.status.error) return noteDraft(`Couldn't save the text first: ${s.status.error ?? "try again"}`);
  try {
    await createBranch(state.repo.full_name, branch, s.doc.git!.commit);
  } catch (e) {
    return noteDraft(e instanceof HttpError && e.status === 422 ? `There's already a branch called ${branch}` : String(e));
  }
  drafting.set(branch, state.branch);
  set("branches", [...new Set([...state.branches, branch])]);
  navigateTo(blobUrl(state.repo.full_name, branch, state.path));
}

// A pull request from this branch into its base (the default branch when none was recorded); the bar then shows it.
export async function openPullRequest(title: string) {
  const s = doc.session;
  if (!s || !state.repo || !title.trim()) return;
  await runDraft("Opening the pull request…", () => createPr(s, state.branch, s.doc.base?.branch ?? state.repo!.default_branch, title.trim()));
  await refreshPr();
}

// GitHub refuses a PR with no commits (422 "No commits between"): then the file gets a newline appended first
// (pulls.touchFile), so the PR exists and its diff touches the file (review comments need both).
async function createPr(s: Session, branch: string, base: string, title: string): Promise<{ pr: Pr; headSha: string }> {
  const full = state.repo!.full_name;
  const body = `Opened from Red Letter: ${location.origin}${blobUrl(full, branch, s.path)}`;
  try {
    return { pr: await openPr(full, branch, base, title, body), headSha: await branchHead(full, branch, true) };
  } catch (e) {
    if (!(e instanceof HttpError && e.status === 422 && /No commits between/i.test(e.message))) throw e;
    const headSha = await touchFile(full, branch, s.path);
    return { pr: await openPr(full, branch, base, title, body), headSha };
  }
}

// The pull request a comment goes on, made when there is none. GitHub has no reviews without a PR. A branch forked
// here (it records its base) gets the PR from itself. Any other branch, main above all, gets the doc's shared review
// branch (pulls.reviewBranch, one per doc and base, so everyone's review is one PR) forked at the doc's last save,
// with a PR back into the branch; an existing one first takes in the branch's latest commits (GitHub's merge), so
// the comment's lines refer to the text as it is now. The caller touches the file the same way createPr does when
// GitHub refuses the comment itself.
export async function ensurePullRequest(s: Session): Promise<{ number: number; headSha: string; branch: string }> {
  const full = state.repo!.full_name;
  let branch = s.branch;
  let base = s.doc.base?.branch;
  if (!base) {
    base = s.branch;
    branch = await reviewBranch(base, s.path);
    try {
      await createBranch(full, branch, s.doc.git!.commit);
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 422)) throw e;
      await mergeInto(full, branch, base); // exists: the review goes on there, caught up with the base
    }
  }
  const open = await openPrFrom(full, branch);
  const { pr, headSha } = open ? { pr: open, headSha: await branchHead(full, branch, true) } : await createPr(s, branch, base, branch === s.branch ? prTitle(branch) : `Review of ${s.path}`);
  return { number: pr.number, headSha, branch };
}

// "satanworker/plan-edits" -> "Plan edits"
export const prTitle = (branch: string) => {
  const words = branch.split("/").pop()!.replaceAll("-", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// GitHub's approval review; GitHub refuses your own PR (422) and says so.
export async function approvePullRequest() {
  const pr = doc.pr;
  if (!pr || !state.repo) return;
  await runDraft("Approving…", () => approvePr(state.repo!.full_name, pr.number));
  await refreshPr();
}

// Merge the open branch's PR through GitHub (protection, required reviews and the merge method are its), then drop
// the branch and go to the base.
export async function mergePullRequest() {
  const pr = doc.pr;
  if (!pr || !state.repo) return;
  const full = state.repo.full_name;
  const merged = await runDraft("Merging…", async (s) => {
    await s.save();
    if (s.status.dirty || s.status.error) throw new Error(`Couldn't save the text first: ${s.status.error ?? "try again"}`);
    await mergePr(full, pr.number);
    await s.dropBranch();
    return true;
  });
  if (!merged) return;
  localStorage.removeItem(tabsKey(full, state.branch)); // the branch is gone
  void listBranches(full, true).then((bs) => set("branches", bs), () => {});
  void refreshPulls();
  navigateTo(blobUrl(full, pr.base, state.path));
}

// Review a PR: its doc on its branch (this doc if the PR changes it, else the first markdown file it changes), with
// the changes against the base highlighted once it opens (docStore: reviewBase, showChanges).
export function reviewPullRequest(pr: { number: number; head: string; base: string }, docs: string[] = []) {
  if (!state.repo) return;
  const path = docs.includes(state.path) || !docs.length ? state.path : docs[0]!;
  setReviewing({ number: pr.number, head: pr.head, base: pr.base });
  if (pr.head === state.branch && path === state.path) void openFile(state.repo, state.branch, state.path, state.user!); // already there: reopen to load the base
  else navigateTo(blobUrl(state.repo.full_name, pr.head, path));
}

export function endReview() {
  setReviewing(null);
  clearReview();
}

// GitHub's "request changes" review, with a note; GitHub refuses it on your own PR (422) and says so.
export async function requestChangesOnPullRequest(number: number, note: string) {
  if (!state.repo || !note.trim()) return;
  await runDraft("Requesting changes…", () => requestChanges(state.repo!.full_name, number, note.trim()));
  await refreshPr();
  void refreshPulls();
}

// Close a PR without merging: a review whose threads are settled, or a branch given up on. The branch goes too; if
// it's the open one, the tab moves to the PR's base.
export async function closePullRequest(pr: { number: number; head: string; base: string }) {
  if (!state.repo) return;
  const full = state.repo.full_name;
  const ok = await runDraft("Closing…", async (s) => {
    await closePr(full, pr.number, pr.head);
    if (pr.head === state.branch) await s.dropBranch();
    return true;
  });
  if (!ok) return;
  void listBranches(full, true).then((bs) => set("branches", bs), () => {});
  void refreshPulls();
  void refreshComments();
  if (pr.head === state.branch) {
    endReview();
    localStorage.removeItem(tabsKey(full, state.branch));
    navigateTo(blobUrl(full, pr.base, state.path));
  }
}

let current = 0;

// /owner/repo · /owner/repo/tree/<branch> · /owner/repo/blob/<branch>/<path> · /owner/repo/<path> (default branch)
export async function openRoute(url: URL, newTab = false): Promise<void> {
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
    if (!fresh && path === state.path && doc.session?.path === path && !doc.opening) return; // already open: the active tab, a link to itself
    const at = fresh ? -1 : state.tabs.indexOf(state.path);
    const saved: string[] = fresh ? JSON.parse(localStorage.getItem(tabsKey(full, branch)) ?? "[]") : [];
    const kept = fresh ? saved.filter((p) => docs.includes(p)) : state.tabs;
    const tabs = !path || kept.includes(path) ? kept : at < 0 ? [...kept, path] : newTab ? kept.toSpliced(at + 1, 0, path) : kept.with(at, path);
    set({ screen: "workspace", user, owner, name, repo: info, branch, docs, path, message: "" });
    setTabs(tabs);
    if (fresh) void listBranches(full).then((bs) => !stale() && set("branches", [...new Set([...bs, branch])]), () => {});
    loadPulls(full);
    if (!path) {
      closeFile();
      set("message", "This branch has no markdown files yet.");
      return;
    }
    if (url.pathname !== blobUrl(full, branch, path)) history.replaceState(null, "", blobUrl(full, branch, path));
    const create = creating.get(path); // created here: start it with this text instead of loading it
    creating.delete(path);
    const draftOf = drafting.get(branch);
    drafting.delete(branch);
    if (!(await openFile(info, branch, path, user, create, draftOf)) && !stale()) set("message", `${path} doesn't exist on ${branch}.`);
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

// After a repo opens: bring every doc of the branch into this browser, one at a time, so any file then opens at
// once. Opening a file always goes first: the loop waits while one is opening. Read-only:
// it never creates snapshots. Stops when another repo or branch opens, or when GitHub can't be reached.
async function syncAll(repo: string, branch: string, cached: string[]) {
  const run = ++syncRun;
  clearIcons(); // another repo or branch: its docs' icons come in as they sync
  try {
    const [docs, heads, head] = await Promise.all([listDocs(repo, branch), snapshotHeads(repo, branch), branchHead(repo, branch)]);
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
        const text = await syncCopy(repo, branch, p, heads.get(await snapshotRef(branch, p)) ?? NO_SNAPSHOT, head, isOpen);
        if (run === syncRun) noteIcon(p, text);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (run !== syncRun) return;
    console.log(`[rl] synced ${docs.length} docs of ${repo}@${branch} in the background`);
  } catch (e) {
    console.warn("[rl] background sync stopped:", e);
  }
}
