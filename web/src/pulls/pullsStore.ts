// The repo's open pull requests, for the side panel's PRs tab: loaded when a repo opens, refreshed on the doc's 15 s
// tick. Grouped by the panel's selectors; GitHub stays the source of truth. Also the review under way: Review on a PR
// opens its doc on the PR's branch with the PR's changes against its base highlighted (docStore.reviewBase); leaving
// that branch ends it.
import { createStore } from "solid-js/store";
import { listPulls, type RepoPr } from "../repo/pulls.ts";

export type Reviewing = { number: number; head: string; base: string };
const [state, set] = createStore({
  repo: "",
  list: [] as RepoPr[],
  loaded: false,
  error: "",
  reviewing: null as Reviewing | null,
});
export const pulls = state;

export function loadPulls(repo: string) {
  if (state.repo !== repo) set({ repo, list: [], loaded: false, error: "", reviewing: null });
  void refreshPulls();
}

export function clearPulls() {
  set({ repo: "", list: [], loaded: false, error: "", reviewing: null });
}

export async function refreshPulls() {
  const repo = state.repo;
  if (!repo) return;
  try {
    const list = await listPulls(repo);
    if (state.repo === repo) set({ list, loaded: true, error: "" });
  } catch (e) {
    if (state.repo === repo) set({ loaded: true, error: e instanceof Error ? e.message : String(e) });
  }
}

export const setReviewing = (r: Reviewing | null) => set("reviewing", r);
