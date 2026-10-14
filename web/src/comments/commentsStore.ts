// Comments of the open file. The list is replaced wholesale from the comments branch.
import { createStore } from "solid-js/store";
import { Comments, type Comment } from "./commentsService.ts";

const [state, set] = createStore({ list: [] as Comment[], file: "" });
export const comments = state;
let service: Comments | null = null;

export async function loadComments(repoName: string, branch: string, path: string) {
  const c = new Comments(repoName, branch, path);
  service = c;
  set({ list: [], file: c.file });
  await refreshComments();
}

export function clearComments() {
  service = null;
  set({ list: [], file: "" });
}

export async function refreshComments() {
  const c = service;
  if (c && (await c.refresh().catch(() => false)) && c === service) set("list", c.list.slice());
}

export async function writeComments(message: string, fn: (l: Comment[]) => Comment[]) {
  const c = service;
  if (!c) return;
  try {
    await c.mutate(message, fn);
    if (c === service) set("list", c.list.slice());
  } catch (e) {
    alert(e instanceof Error ? e.message : String(e));
  }
}
