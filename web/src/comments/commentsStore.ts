// Comments are part of the doc (inline.ts), so on a branch you can edit they come and go with the doc itself. On a
// protected branch they go through the doc's comment pull request (commentsPr.ts): this store holds that PR and its
// copy of the doc, refreshed on the 15 s tick.
import { createStore } from "solid-js/store";
import { commitToPr, readPr, type Pr } from "./commentsPr.ts";

type Target = { repo: string; branch: string; path: string };
const [state, set] = createStore({ viaPr: false, pr: null as Pr | null, text: null as string | null, sending: false, error: "" });
export const comments = state;
let cur: Target | null = null;

export function loadComments(repo: string, branch: string, path: string, viaPr: boolean) {
  cur = viaPr ? { repo, branch, path } : null;
  set({ viaPr, pr: null, text: null, sending: false, error: "" });
  void refreshComments();
}

export function clearComments() {
  cur = null;
  set({ viaPr: false, pr: null, text: null, sending: false, error: "" });
}

let writes = 0; // a refresh that started before a write ended reads an older copy: dropped
export async function refreshComments() {
  const t = cur;
  const w = writes;
  if (!t || state.sending) return;
  try {
    const r = await readPr(t.repo, t.branch, t.path);
    if (cur === t && !state.sending && w === writes) set({ pr: r?.pr ?? null, text: r?.text ?? null });
  } catch (e) {
    console.warn("[rl] reading the comment PR:", e);
  }
}

// ponytail: no queue; a failed comment is reported (with its text, to copy) instead of retried.
// ready: what has to happen first (the doc catching up with the branch); "sending" shows meanwhile.
export async function commentViaPr(message: string, edit: (text: string) => string, body: string, ready: Promise<unknown>) {
  const t = cur;
  if (!t) return;
  writes++;
  set({ sending: true, error: "" });
  try {
    await ready;
    const r = await commitToPr(t.repo, t.branch, t.path, message, edit);
    if (cur === t) set({ pr: r.pr, text: r.text });
  } catch (e) {
    if (cur === t) set("error", `${e instanceof Error ? e.message : String(e)}${body ? ` — not sent: “${body}”` : ""}`);
  } finally {
    if (cur === t) set("sending", false);
  }
}
