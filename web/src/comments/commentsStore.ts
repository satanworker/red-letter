// Comments are part of the doc (inline.ts), so on a branch you can edit they come and go with the doc itself. On a
// protected branch they go through the doc's comment pull request (commentsPr.ts): this store holds that PR and its
// copy of the doc, refreshed on the 15 s tick.
// On a branch with an open pull request (doc.pr) comments can go to the PR instead, as GitHub review comments on the
// file: this store holds the PR's review threads on it (refreshed on the tick and after each write) and `mode`, where
// new comments go, remembered per repo.
import { createStore } from "solid-js/store";
import { doc } from "../doc/docStore.ts";
import { prThreads as fetchPrThreads, type PrThread } from "../repo/pulls.ts";
import { commitToPr, readPr, type Pr } from "./commentsPr.ts";

type Target = { repo: string; branch: string; path: string; viaPr: boolean };
export type Mode = "pr" | "file";
const modeKey = (repo: string) => `rl_comments:${repo}`;
const [state, set] = createStore({
  viaPr: false,
  pr: null as Pr | null,
  text: null as string | null,
  prThreads: [] as PrThread[],
  mode: "pr" as Mode,
  sending: false,
  error: "",
});
export const comments = state;
let cur: Target | null = null;

export function loadComments(repo: string, branch: string, path: string, viaPr: boolean) {
  cur = { repo, branch, path, viaPr };
  set({ viaPr, pr: null, text: null, prThreads: [], sending: false, error: "", mode: localStorage.getItem(modeKey(repo)) === "file" ? "file" : "pr" });
  void refreshComments();
}

export function clearComments() {
  cur = null;
  set({ viaPr: false, pr: null, text: null, prThreads: [], sending: false, error: "" });
}

// New comments go to a pull request (GitHub review comments) rather than into the file: in PR mode for anyone who
// can push (a PR is made for the first one if there's none), and for someone who can't edit the branch (a reviewer
// with read access) whenever a PR is open, whatever the mode says.
export const commentsOnPr = () => (state.mode === "pr" && doc.session?.canWrite === true) || (doc.pr !== null && !(doc.session?.canWrite || state.viaPr));
export function setCommentsMode(mode: Mode) {
  set("mode", mode);
  if (cur) localStorage.setItem(modeKey(cur.repo), mode);
}

let writes = 0; // a refresh that started before a write ended reads an older copy: dropped
export async function refreshComments() {
  const t = cur;
  const w = writes;
  if (!t) return;
  void refreshPrThreads();
  if (!t.viaPr || state.sending) return;
  try {
    const r = await readPr(t.repo, t.branch, t.path);
    if (cur === t && !state.sending && w === writes) set({ pr: r?.pr ?? null, text: r?.text ?? null });
  } catch (e) {
    console.warn("[rl] reading the comment PR:", e);
  }
}

async function refreshPrThreads() {
  const t = cur, pr = doc.pr;
  const w = writes;
  if (!t) return;
  if (!pr) {
    if (state.prThreads.length) set("prThreads", []);
    return;
  }
  try {
    const threads = await fetchPrThreads(t.repo, pr.number, t.path);
    if (cur === t && w === writes) set("prThreads", threads);
  } catch (e) {
    console.warn("[rl] reading the pull request's comments:", e);
  }
}

// One write to the PR (a comment, reply, resolve, delete), then its threads read again. Returns what the write did,
// undefined on failure, which is reported with the comment's text, to copy.
export async function writeOnPr<T>(action: () => Promise<T>, body = ""): Promise<T | undefined> {
  const t = cur;
  if (!t) return;
  writes++;
  set({ sending: true, error: "" });
  try {
    const r = await action();
    if (cur === t) await refreshPrThreads();
    return r;
  } catch (e) {
    if (cur === t) set("error", `${e instanceof Error ? e.message : String(e)}${body ? ` — not sent: “${body}”` : ""}`);
  } finally {
    if (cur === t) set("sending", false);
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
