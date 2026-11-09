// Pull requests: GitHub's own review and merge. Used by the branch bar (open, approve, merge), by comments that go on
// the PR (commentsStore) and by a protected branch's comment PR (commentsPr). Stateless; never imports a store.
import { HttpError, b64, cachedGet, encPath, gh, ghJson, graphql, post, sha1, unb64 } from "../github.ts";
import { idbGet, idbPut } from "../idb.ts";

export type Pr = { number: number; url: string };
export type PrState = Pr & {
  base: string;
  head: string;
  headSha: string;
  title: string;
  author: string;
  mergeable: boolean | null; // null: GitHub is still working it out (asked again on the next poll)
  approved: string[]; // reviewers whose latest verdict is an approval
  changesRequested: string[]; // … or a request for changes
};
type PrJson = { number: number; html_url: string; title: string; mergeable: boolean | null; base: { ref: string }; head: { ref: string; sha: string }; user: { login: string } };

// The open PR from `head` (into `base`, if given). Always asked of GitHub, an unchanged answer is a free 304: a shared
// in-flight request or a recent answer could predate a PR just opened.
export async function openPrFrom(repo: string, head: string, base?: string): Promise<Pr | null> {
  const owner = repo.split("/")[0];
  const q = `state=open&head=${encodeURIComponent(`${owner}:${head}`)}${base ? `&base=${encodeURIComponent(base)}` : ""}`;
  const [p]: PrJson[] = JSON.parse(await cachedGet(`/repos/${repo}/pulls?${q}`, { fresh: true }));
  return p ? { number: p.number, url: p.html_url } : null;
}

export async function openPr(repo: string, head: string, base: string, title: string, body: string): Promise<Pr> {
  const p = await post<PrJson>(`/repos/${repo}/pulls`, { title, head, base, body });
  return { number: p.number, url: p.html_url };
}

// The open PR from `head` with GitHub's view of it: mergeable, and each reviewer's latest verdict (comment-only
// reviews don't count, as on GitHub).
export async function prState(repo: string, head: string): Promise<PrState | null> {
  const pr = await openPrFrom(repo, head);
  if (!pr) return null;
  type Review = { user: { login: string } | null; state: string };
  // GitHub works `mergeable` out in the background after the first read, and its ETag doesn't move when the answer
  // lands: a copy saying null is asked again without the ETag.
  const detail = async (): Promise<PrJson> => {
    const p: PrJson = JSON.parse(await cachedGet(`/repos/${repo}/pulls/${pr.number}`, { fresh: true }));
    return p.mergeable === null ? ghJson<PrJson>(`/repos/${repo}/pulls/${pr.number}`) : p;
  };
  const [p, reviews] = await Promise.all([detail(), cachedGet(`/repos/${repo}/pulls/${pr.number}/reviews?per_page=100`).then((s) => JSON.parse(s) as Review[])]);
  const latest = new Map<string, string>();
  for (const r of reviews) if (r.user && (r.state === "APPROVED" || r.state === "CHANGES_REQUESTED")) latest.set(r.user.login, r.state);
  const by = (s: string) => [...latest].filter(([, v]) => v === s).map(([k]) => k);
  return { ...pr, base: p.base.ref, head: p.head.ref, headSha: p.head.sha, title: p.title, author: p.user.login, mergeable: p.mergeable, approved: by("APPROVED"), changesRequested: by("CHANGES_REQUESTED") };
}

// GitHub answers 422 for your own PR; its message is kept.
export async function approvePr(repo: string, number: number): Promise<void> {
  await post(`/repos/${repo}/pulls/${number}/reviews`, { event: "APPROVE" });
}

// GitHub's merge with the repo's default method; 405 (protection, conflicts, failing checks) and 409 (head moved)
// come back as errors carrying GitHub's message. Returns the merge commit's sha.
export async function mergePr(repo: string, number: number, attempt = 1): Promise<string> {
  const res = await gh(`/repos/${repo}/pulls/${number}/merge`, { method: "PUT", body: "{}" });
  const body: { sha?: string; message?: string } = await res.json().catch(() => ({}));
  // "Base branch was modified. Review and try the merge again.": GitHub rechecking mergeability after a recent
  // commit, seen right after a save on the branch; one retry is what it asks for
  if (res.status === 405 && attempt === 1 && /try the merge again/i.test(body.message ?? "")) {
    await new Promise((r) => setTimeout(r, 2000));
    return mergePr(repo, number, 2);
  }
  if (!res.ok) throw new HttpError(res.status, body.message ?? `merge -> ${res.status}`);
  return body.sha!;
}

export type PrLink = Pr & { head: string; base: string; title: string }; // an open PR a doc takes part in

// ---- the repo's open PRs, cheaply ----
// REST, through cachedGet: GitHub answers 304 to the ETag when nothing changed, and 304s don't count against the
// rate limit. GraphQL has no ETags and bills by nodes asked for, so nothing GraphQL runs on a timer: callers compare
// the `stamp` (the PRs' numbers and updated_at) with the last one and ask GraphQL only when a PR they care about
// moved, or right after a write of their own. A review comment bumps the PR's updated_at; a resolve may not (own
// resolves refresh anyway).
export type OpenPr = PrLink & { author: string; draft: boolean; updatedAt: string; reviewers: string[] };
export async function openPulls(repo: string): Promise<{ prs: OpenPr[]; stamp: string }> {
  type J = { number: number; html_url: string; title: string; draft: boolean; updated_at: string; user: { login: string } | null; head: { ref: string }; base: { ref: string }; requested_reviewers: { login: string }[] };
  const list: J[] = JSON.parse(await cachedGet(`/repos/${repo}/pulls?state=open&per_page=100`));
  return {
    prs: list.map((p) => ({ number: p.number, url: p.html_url, title: p.title, head: p.head.ref, base: p.base.ref, author: p.user?.login ?? "ghost", draft: p.draft, updatedAt: p.updated_at, reviewers: p.requested_reviewers.map((r) => r.login) })),
    stamp: list.map((p) => `${p.number}@${p.updated_at}`).join(" "),
  };
}

// ---- review threads: comments on pull requests ----
// GitHub anchors a review comment to a line of the file (a range of lines with start_line), or to the file as a
// whole (subject_type file). Threads, resolution and "outdated" are GraphQL-only.

export type PrComment = { id: number; nodeId: string; author: string; at: string; body: string };
export type PrThread = {
  id: string; // the thread's node id (for resolving)
  pr: PrLink; // the pull request the thread is on
  path: string;
  line: number | null; // GitHub's current line (1-based), null for a file-level or outdated thread
  startLine: number | null;
  resolved: boolean;
  outdated: boolean; // the commented lines changed since; GitHub keeps the thread but can't place it
  comments: PrComment[]; // the first is the thread's own comment; replies follow
};
export type PrDetail = { pr: PrLink; files: PrDoc[]; threads: PrThread[]; decision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null };
export type PrDoc = { path: string; additions: number; deletions: number };

type ThreadNode = {
  id: string;
  path: string;
  line: number | null;
  startLine: number | null;
  subjectType: "LINE" | "FILE";
  isResolved: boolean;
  isOutdated: boolean;
  comments: { nodes: { databaseId: number; id: string; author: { login: string } | null; createdAt: string; body: string }[] };
};
type DetailNode = { reviewDecision: PrDetail["decision"]; files: { nodes: PrDoc[] }; reviewThreads: { nodes: ThreadNode[] } };

// The given PRs' changed files and review threads, in one GraphQL call with one alias per PR. Each PR's answer is
// kept in this browser under its updated_at, so a reload or another tab asks only for PRs that moved since (`fresh`:
// ask anyway, after a write of ours: a resolve doesn't always bump updated_at).
// ponytail: 50 files, 30 threads and 30 comments each, no paging; cost ≈ 10 points a PR
export async function prDetails(repo: string, prs: OpenPr[], fresh = false): Promise<PrDetail[]> {
  const key = (p: OpenPr) => `gql pr ${repo}#${p.number}@${p.updatedAt}`;
  const kept = new Map<number, DetailNode>();
  if (!fresh) for (const p of prs) { const c = await idbGet<{ body: string }>("http", key(p)); if (c) kept.set(p.number, JSON.parse(c.body)); }
  const ask = prs.filter((p) => !kept.has(p.number));
  if (ask.length) {
    const [owner, name] = repo.split("/");
    const q = `query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){ ${ask.map((p, i) => `p${i}: pullRequest(number:${p.number}){ ...d }`).join(" ")} } }
fragment d on PullRequest { reviewDecision files(first:50){ nodes{ path additions deletions } } reviewThreads(first:30){ nodes{ id path line startLine subjectType isResolved isOutdated
  comments(first:30){ nodes{ databaseId id author{ login } createdAt body } } } } }`;
    const r = await graphql<{ repository: Record<string, DetailNode | null> }>(q, { owner, name });
    await Promise.all(ask.map((p, i) => { const n = r.repository[`p${i}`]; if (!n) return; kept.set(p.number, n); return idbPut("http", key(p), { etag: "", body: JSON.stringify(n) }); }));
  }
  const d = { repository: Object.fromEntries(prs.map((p, i) => [`p${i}`, kept.get(p.number) ?? null])) };
  return prs.flatMap((pr, i) => {
    const n = d.repository[`p${i}`];
    if (!n) return [];
    const threads = n.reviewThreads.nodes.map((t): PrThread => {
      const placed = !t.isOutdated && t.subjectType === "LINE"; // a file-level thread says line 1; it isn't on a line
      return {
        id: t.id,
        pr,
        path: t.path,
        line: placed ? t.line : null,
        startLine: placed ? t.startLine : null,
        resolved: t.isResolved,
        outdated: t.isOutdated,
        comments: t.comments.nodes.map((c) => ({ id: c.databaseId, nodeId: c.id, author: c.author?.login ?? "ghost", at: c.createdAt, body: c.body })),
      };
    });
    return [{ pr, files: n.files.nodes, threads, decision: n.reviewDecision }];
  });
}

// ---- the repo's open pull requests, for the panel's PRs tab ----
export type RepoPr = OpenPr & {
  decision: PrDetail["decision"];
  docs: PrDoc[]; // the markdown files it changes (first 50 files looked at)
  open: number; // review threads still open, across the PR
  resolved: number;
  review: boolean; // one of our review branches: the PR is the comments, the diff is one newline
  threads: PrThread[]; // across all its files
};
export const isDoc = (p: string) => /\.(md|markdown|mdx|txt)$/i.test(p);
export const isReviewBranch = (head: string) => head.startsWith("red-letter/review/");

// The open PRs with their details (ponytail: the 30 most recently updated; one GraphQL call).
export async function listPulls(repo: string, prs: OpenPr[], fresh = false): Promise<RepoPr[]> {
  const top = [...prs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 30);
  const details = new Map((await prDetails(repo, top, fresh)).map((d) => [d.pr.number, d]));
  return top.map((p) => {
    const d = details.get(p.number);
    const threads = d?.threads ?? [];
    return {
      ...p,
      decision: d?.decision ?? null,
      docs: (d?.files ?? []).filter((f) => isDoc(f.path)),
      open: threads.filter((t) => !t.resolved).length,
      resolved: threads.filter((t) => t.resolved).length,
      review: isReviewBranch(p.head),
      threads,
    };
  });
}

// A "request changes" review with a note; GitHub refuses it on your own PR (422).
export async function requestChanges(repo: string, number: number, body: string): Promise<void> {
  await post(`/repos/${repo}/pulls/${number}/reviews`, { event: "REQUEST_CHANGES", body });
}

// Closes the PR without merging and deletes its branch (a review branch is recreated by the next review; its snapshot
// ref is keyed by the branch name and reused). 404/422 on the branch: already gone.
export async function closePr(repo: string, number: number, head: string): Promise<void> {
  await ghJson(`/repos/${repo}/pulls/${number}`, { method: "PATCH", body: JSON.stringify({ state: "closed" }) });
  const res = await gh(`/repos/${repo}/git/refs/heads/${encPath(head)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404 && res.status !== 422) throw new HttpError(res.status, `deleting ${head}: ${res.status} ${await res.text()}`);
}

// The branch a review of `path` on `base` happens on: shared by everyone reviewing that doc, so one PR holds the
// conversation. Hashed like the snapshot refs: a path isn't always a valid ref name, and "<base>/<path>" collides.
export const reviewBranch = async (base: string, path: string) => `red-letter/review/${await sha1(base)}/${await sha1(path)}`;

// `base` merged into `branch` (GitHub's merge), so the branch carries the base's latest text; 409 = conflict.
export async function mergeInto(repo: string, branch: string, base: string): Promise<void> {
  const res = await gh(`/repos/${repo}/merges`, { method: "POST", body: JSON.stringify({ base: branch, head: base, commit_message: `Merge ${base} into the review of it` }) });
  if (res.status === 409) throw new HttpError(409, `The review branch conflicts with ${base}: resolve it on GitHub`);
  if (!res.ok && res.status !== 204) throw new HttpError(res.status, `updating the review branch: ${res.status} ${await res.text()}`);
}

// GitHub takes review comments only on the PR's diff: a line outside the file's changed lines (and the few context
// lines around them) gets `what: "line"`, so the caller can comment on the file as a whole; a file the PR doesn't
// touch at all gets `what: "path"`, so the caller can put the file in the PR first (touchFile).
export class NotInDiff extends Error {
  constructor(
    text: string,
    public what: "line" | "path",
  ) {
    super(text);
  }
}

// One newline appended to `path` on `branch` (the file's own EOL), so the PR from the branch has a diff touching it:
// GitHub has no other way to review a file nobody changed. Returns the commit's sha.
export async function touchFile(repo: string, branch: string, path: string): Promise<string> {
  const file: { sha: string; content: string } = JSON.parse(await cachedGet(`/repos/${repo}/contents/${encPath(path)}?ref=${encodeURIComponent(branch)}`, { fresh: true }));
  const raw = unb64(file.content);
  const eol = new TextEncoder().encode(raw.includes(13) ? "\r\n" : "\n");
  const content = new Uint8Array(raw.length + eol.length);
  content.set(raw);
  content.set(eol, raw.length);
  const r = await ghJson<{ commit: { sha: string } }>(`/repos/${repo}/contents/${encPath(path)}`, {
    method: "PUT",
    body: JSON.stringify({ message: `Start a review of ${path} in Red Letter`, content: b64(content), sha: file.sha, branch }),
  });
  return r.commit.sha;
}

// A new thread on the PR's `path`: on lines start..end (1-based, inclusive, the new side of the diff), or on the
// file as a whole when `lines` is left out. commitSha: the PR head the lines refer to.
export async function commentOnPr(repo: string, number: number, commitSha: string, path: string, body: string, lines?: { start: number; end: number }): Promise<PrComment> {
  const anchor = lines
    ? { line: lines.end, side: "RIGHT", ...(lines.start < lines.end ? { start_line: lines.start, start_side: "RIGHT" } : {}) }
    : { subject_type: "file" };
  const res = await gh(`/repos/${repo}/pulls/${number}/comments`, { method: "POST", body: JSON.stringify({ body, commit_id: commitSha, path, ...anchor }) });
  if (res.status === 422) {
    const text = await res.text();
    // the refusal names the line field: "…line must be part of the diff" (2024), "…line could not be resolved" (2026)
    if (/pull_request_review_thread\.path/.test(text)) throw new NotInDiff(text, "path");
    if (/pull_request_review_thread\.(line|start_line|diff_hunk)/.test(text)) throw new NotInDiff(text, "line");
    throw new HttpError(422, text);
  }
  if (!res.ok) throw new HttpError(res.status, `commenting on #${number}: ${res.status} ${await res.text()}`);
  return toComment(await res.json());
}

type CommentJson = { id: number; node_id: string; user: { login: string } | null; created_at: string; body: string };
const toComment = (c: CommentJson): PrComment => ({ id: c.id, nodeId: c.node_id, author: c.user?.login ?? "ghost", at: c.created_at, body: c.body });

// A reply in the thread of `commentId` (the thread's first comment; GitHub takes replies only there).
export async function replyOnPr(repo: string, number: number, commentId: number, body: string): Promise<PrComment> {
  return toComment(await ghJson<CommentJson>(`/repos/${repo}/pulls/${number}/comments/${commentId}/replies`, { method: "POST", body: JSON.stringify({ body }) }));
}

export async function setThreadResolved(threadId: string, resolved: boolean): Promise<void> {
  const m = resolved ? "resolveReviewThread" : "unresolveReviewThread";
  await graphql(`mutation($id:ID!){ ${m}(input:{threadId:$id}){ thread{ id } } }`, { id: threadId });
}

// Deletes one review comment (yours, or any with push access). Deleting a thread's first comment deletes the thread.
export async function deletePrComment(repo: string, commentId: number): Promise<void> {
  const res = await gh(`/repos/${repo}/pulls/comments/${commentId}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new HttpError(res.status, `deleting the comment: ${res.status} ${await res.text()}`);
}
