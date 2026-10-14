// Which screen is showing, and the open repo + branch: info, the branch's markdown files, the current path.
// openRoute is the one entry point: page load, links, back/forward (see main.tsx).
import { createStore } from "solid-js/store";
import { closeFile, openFile } from "../doc/docStore.ts";
import { authKind, completeSignIn, currentUser, token, type User } from "../github.ts";
import { appInstalledOn, blobUrl, getRepo, listDocs, resolveBranch, type RepoInfo } from "./repoService.ts";

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
    const docs = same && branch === state.branch ? state.docs : await listDocs(full, branch);
    // no file in the URL: the README (or the first document) of the branch
    path ||= docs.find((p) => /^readme\.md$/i.test(p)) ?? docs.find((p) => /(^|\/)readme\.md$/i.test(p)) ?? docs[0] ?? "";
    const user = state.user ?? (await currentUser());
    if (stale() || !user) return;
    set({ screen: "workspace", user, owner, name, repo: info, branch, docs, path, message: "" });
    if (!path) {
      closeFile();
      set("message", "This branch has no markdown files yet.");
      return;
    }
    if (url.pathname !== blobUrl(full, branch, path)) history.replaceState(null, "", blobUrl(full, branch, path));
    if (!(await openFile(info, branch, path, user)) && !stale()) set("message", `${path} doesn't exist on ${branch}.`);
  } catch (e) {
    if (!stale()) set({ screen: "error", message: e instanceof Error ? e.message : String(e) });
  }
}
