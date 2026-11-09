// The repo's open pull requests, for the side panel's PRs tab and review mode: loaded when a repo opens, refreshed on
// the doc's 15 s tick. The open-PR list is REST (ETag: free when unchanged); its details (files, threads, decision)
// are GraphQL, asked only when the list's stamp (numbers + updated_at) changed, or `force`d after a write of ours.
// Also the review under way: Review on a PR opens its doc on the PR's branch with the PR's changes against its base
// highlighted (docStore.reviewBase); leaving that branch ends it.
import { createStore } from "solid-js/store";
import { listPulls, openPulls, type RepoPr } from "../repo/pulls.ts";

export type Reviewing = { number: number; head: string; base: string };
const [state, set] = createStore({ repo: "", list: [] as RepoPr[], loaded: false, error: "", reviewing: null as Reviewing | null, focusThread: "" });
export const pulls = state;
let stamp = "";

export function loadPulls(repo: string) {
  if (state.repo !== repo) {
    stamp = "";
    set({ repo, list: [], loaded: false, error: "", reviewing: null });
  }
  void refreshPulls();
}

export function clearPulls() {
  stamp = "";
  set({ repo: "", list: [], loaded: false, error: "", reviewing: null });
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

export const setReviewing = (r: Reviewing | null) => set("reviewing", r);
// A thread picked in the review sidebar whose doc is still opening: commentsStore lights it once its threads arrive.
export const setFocusThread = (id: string) => set("focusThread", id);
