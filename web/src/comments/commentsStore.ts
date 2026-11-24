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
import { errorText, toast } from "../toast.ts";

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

// The open PRs of the branch just left: another file of that branch starts with them (they're mostly the branch's),
// so the panel's toggle and "goes to pull request #N" don't blink while its own are read
let left: { key: string; prs: PrLink[] } | null = null;

export function loadComments(repo: string, branch: string, path: string, viaPr: boolean) {
  const t = (cur = { repo, branch, path, viaPr });
  stamp = ""; // the threads were just cleared: the next refresh must fill them, even if no PR moved
  const prs = left?.key === `${repo} ${branch}` ? left.prs : [];
  set({ viaPr, pr: null, text: null, prThreads: [], prs, review: "", sending: false, error: "", mode: localStorage.getItem(modeKey(repo)) === "file" ? "file" : "pr" });
  void reviewBranch(branch, path).then((r) => cur === t && set("review", r));
  void refreshComments();
}

export function clearComments() {
  if (cur) left = { key: `${cur.repo} ${cur.branch}`, prs: state.prs };
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
// Which threads the panel and the text show: the toggle's side, the PR's or the file's (the PR's when the file's is
// locked: no edit rights). No toggle (no PR, no edit rights): null, every thread.
export const commentsShown = (): Mode | null =>
  !(targetPr() || doc.session?.canWrite) ? null : !(doc.session?.canWrite || state.viaPr) ? "pr" : state.mode;
export function setCommentsMode(mode: Mode) {
  set("mode", mode);
  if (cur) localStorage.setItem(modeKey(cur.repo), mode);
}

// A write that failed: a toast, with the comment's text to copy when there was one
const notSent = (e: unknown, body: string) => toast(body ? `${errorText(e)} — not sent: “${body}”` : errorText(e), "error", body || undefined);

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
    // a poll while writes are on their way would wipe what they show already (optimistic): the write's own refresh comes
    if (cur !== t || w !== writes || (!force && inFlight)) return;
    stamp = s;
    // the PR from the branch first, then the PRs into it that change this file
    const kept = details.filter((d) => d.pr.head === t.branch || d.files.some((f) => f.path === t.path)).sort((a, b) => Number(b.pr.head === t.branch) - Number(a.pr.head === t.branch));
    set({ prs: kept.map((d) => d.pr), prThreads: kept.flatMap((d) => d.threads.filter((th) => th.path === t.path)) });
  } catch (e) {
    console.warn("[rl] reading the pull requests' comments:", e);
  }
}

// One write to the PR (a comment, reply, resolve, delete), then its threads read again. Optimistic: `shown` changes
// the threads at once (a new comment with a negative id, which the panel marks "Sending…"), and the threads read after
// the write replace them; a write that fails puts them back and says so in a toast, with the comment's text to copy.
// Returns what the write did, undefined on failure.
let inFlight = 0;
export async function writeOnPr<T>(action: () => Promise<T>, body = "", shown?: (threads: PrThread[]) => PrThread[]): Promise<T | undefined> {
  const t = cur;
  if (!t) return;
  writes++;
  inFlight++;
  const before = state.prThreads;
  set({ sending: true, error: "" });
  if (shown) set("prThreads", shown(state.prThreads));
  try {
    const r = await action();
    if (cur === t) await refreshPrThreads(true);
    return r;
  } catch (e) {
    if (cur !== t) return;
    if (shown) set("prThreads", before);
    notSent(e, body);
  } finally {
    inFlight--;
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
    // optimistic: the comment PR's copy shows the change now (the threads come from it); the commit's copy replaces it
    const before = state.text;
    try {
      if (before !== null) set("text", edit(before));
    } catch {} // an edit that can't apply to this copy yet: it shows once committed
    try {
      await ready;
    } catch (e) {
      if (cur === t) set("text", before);
      throw e;
    }
    const r = await commitToPr(t.repo, t.branch, t.path, message, edit).catch((e: unknown) => {
      if (cur === t) set("text", before);
      throw e;
    });
    if (cur === t) set({ pr: r.pr, text: r.text });
  } catch (e) {
    if (cur === t) notSent(e, body);
  } finally {
    if (cur === t) set("sending", false);
  }
}
