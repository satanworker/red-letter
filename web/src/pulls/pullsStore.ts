// The repo's open pull requests, for the left sidebar's Pull requests view and review mode: loaded when a repo
// opens, refreshed on the doc's 15 s tick. The open-PR list is REST (ETag: free when unchanged); its details (files,
// threads, decision) are GraphQL, asked only when the list's stamp (numbers + updated_at) changed, or `force`d after a
// write of ours. Also the review under way: a PR's file clicked in the tree opens it on the PR's branch with the PR's
// changes against its base highlighted (docStore.reviewBase). Only ever started on purpose (repoStore.toggleReview);
// leaving that branch ends it.
import { createStore } from "solid-js/store";
import { commentOnConversation, listPulls, openPulls, type RepoPr } from "../repo/pulls.ts";

export type Reviewing = { number: number; head: string; base: string };
type View = "files" | "pulls";
const [state, set] = createStore({
  repo: "",
  list: [] as RepoPr[],
  loaded: false,
  error: "",
  reviewing: null as Reviewing | null,
  view: (localStorage.getItem("rl_sidebar") === "pulls" ? "pulls" : "files") as View, // the left sidebar: the branch's files or the open PRs
  open: [] as number[], // PRs unfolded in the tree
  posting: false,
  postError: "",
});
export const pulls = state;
let stamp = "";

export function loadPulls(repo: string) {
  if (state.repo !== repo) {
    stamp = "";
    set({ repo, list: [], loaded: false, error: "", reviewing: null, open: [] });
  }
  void refreshPulls();
}

export function clearPulls() {
  stamp = "";
  set({ repo: "", list: [], loaded: false, error: "", reviewing: null, open: [] });
}

export async function refreshPulls(force = false) {
  const repo = state.repo;
  if (!repo) return;
  try {
    const open = await openPulls(repo);
    if (open.stamp === stamp && !force) return;
    const list = await listPulls(repo, open.prs, force);
    if (state.repo !== repo) return;
    stamp = open.stamp;
    set({ list, loaded: true, error: "" });
  } catch (e) {
    if (state.repo === repo) set({ loaded: true, error: e instanceof Error ? e.message : String(e) });
  }
}

export const setReviewing = (r: Reviewing | null) => {
  set("reviewing", r);
  if (r) {
    showView("pulls");
    if (!state.open.includes(r.number)) set("open", [...state.open, r.number]);
  }
};
export function showView(view: View) {
  set("view", view);
  localStorage.setItem("rl_sidebar", view);
}
export const togglePr = (n: number) => set("open", state.open.includes(n) ? state.open.filter((x) => x !== n) : [...state.open, n]);

export const unfoldPr = (n: number) => {
  if (!state.open.includes(n)) set("open", [...state.open, n]);
  set("postError", "");
};

// A comment on the PR itself; the list is asked again for it (GraphQL, the PR's updated_at moved)
export async function commentOnPullRequest(n: number, body: string): Promise<boolean> {
  if (!state.repo || !body.trim() || state.posting) return false;
  set({ posting: true, postError: "" });
  try {
    await commentOnConversation(state.repo, n, body.trim());
    await refreshPulls(true);
    return true;
  } catch (e) {
    set("postError", e instanceof Error ? e.message : String(e));
    return false;
  } finally {
    set("posting", false);
  }
}
