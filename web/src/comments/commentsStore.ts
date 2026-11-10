// Comments are part of the doc (inline.ts), so on a branch you can edit they come and go with the doc itself. On a
// protected branch they go through the doc's comment pull request (commentsPr.ts): this store holds that PR and its
// copy of the doc, refreshed on the 15 s tick.
// On a branch with an open pull request (doc.pr) comments can go to the PR instead, as GitHub review comments on the
// file: this store holds the PR's review threads on it (refreshed on the tick and after each write) and `mode`, where
// new comments go, remembered per repo.
import { createStore } from "solid-js/store";
import { doc } from "../doc/docStore.ts";
import { openPulls, prDetails, reviewBranch, type PrLink, type PrThread } from "../repo/pulls.ts";
import { commitToPr, readPr, type Pr } from "./commentsPr.ts";

type Target = { repo: string; branch: string; path: string; viaPr: boolean };
export type Mode = "pr" | "file";
const modeKey = (repo: string) => `rl_comments:${repo}`;
const [state, set] = createStore({
  viaPr: false,
  pr: null as Pr | null,
  text: null as string | null,
  prThreads: [] as PrThread[],
  prs: [] as PrLink[], // the open PRs from this branch and into it, the former first
  review: "", // the shared review branch of this doc on its branch (pulls.reviewBranch), once hashed
  mode: "pr" as Mode,
  sending: false,
  error: "",
});
export const comments = state;
let cur: Target | null = null;

export function loadComments(repo: string, branch: string, path: string, viaPr: boolean) {
  const t = (cur = { repo, branch, path, viaPr });
  stamp = ""; // the threads were just cleared: the next refresh must fill them, even if no PR moved
  set({ viaPr, pr: null, text: null, prThreads: [], prs: [], review: "", sending: false, error: "", mode: localStorage.getItem(modeKey(repo)) === "file" ? "file" : "pr" });
  void reviewBranch(branch, path).then((r) => cur === t && set("review", r));
  void refreshComments();
}

export function clearComments() {
  cur = null;
  stamp = "";
  set({ viaPr: false, pr: null, text: null, prThreads: [], prs: [], review: "", sending: false, error: "" });
}

// The PR a new comment goes to, if one exists: the PR from this branch, else the shared review of this doc on it
// (repoStore.ensurePullRequest makes one when there's none).
export const targetPr = () => state.prs.find((p) => p.head === cur?.branch) ?? state.prs.find((p) => state.review && p.head === state.review) ?? null;

// New comments go to a pull request (GitHub review comments) rather than into the file: in PR mode for anyone who
// can push (a PR is made for the first one if there's none), and for someone who can't edit the branch (a reviewer
// with read access) whenever a PR is open, whatever the mode says.
export const commentsOnPr = () => (state.mode === "pr" && doc.session?.canWrite === true) || (targetPr() !== null && !(doc.session?.canWrite || state.viaPr));
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

// The review threads on this doc across the open PRs from its branch and into it, and those PRs (the one from the
// branch first). The open-PR list (REST, ETag: free when unchanged) is read on every tick; GitHub's GraphQL (billed by
// nodes, no ETags) is asked only when one of those PRs' updated_at moved, or `force`d after a write of our own.
let stamp = "";
async function refreshPrThreads(force = false) {
  const t = cur;
  const w = writes;
  if (!t) return;
  try {
    const open = await openPulls(t.repo);
    const mine = open.prs.filter((p) => p.head === t.branch || p.base === t.branch);
    const s = `${t.branch} ${t.path} ${mine.map((p) => `${p.number}@${p.updatedAt}`).join(" ")}`;
    if (s === stamp && !force) return;
    const details = await prDetails(t.repo, mine, force);
    if (cur !== t || w !== writes) return;
    stamp = s;
    // the PR from the branch first, then the PRs into it that change this file
    const kept = details.filter((d) => d.pr.head === t.branch || d.files.some((f) => f.path === t.path)).sort((a, b) => Number(b.pr.head === t.branch) - Number(a.pr.head === t.branch));
    set({ prs: kept.map((d) => d.pr), prThreads: kept.flatMap((d) => d.threads.filter((th) => th.path === t.path)) });
  } catch (e) {
    console.warn("[rl] reading the pull requests' comments:", e);
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
    if (cur === t) await refreshPrThreads(true);
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
