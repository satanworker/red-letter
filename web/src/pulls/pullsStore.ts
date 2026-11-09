// The repo's open pull requests, for the side panel's Pull requests tab: loaded when a repo opens, refreshed on the
// doc's 15 s tick. Grouped by the panel's selectors; GitHub stays the source of truth.
import { createStore } from "solid-js/store";
import { listPulls, type RepoPr } from "../repo/pulls.ts";

const [state, set] = createStore({ repo: "", list: [] as RepoPr[], loaded: false, error: "" });
export const pulls = state;

export function loadPulls(repo: string) {
  if (state.repo !== repo) set({ repo, list: [], loaded: false, error: "" });
  void refreshPulls();
}

export function clearPulls() {
  set({ repo: "", list: [], loaded: false, error: "" });
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
