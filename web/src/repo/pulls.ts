// Pull requests: GitHub's own review and merge. Used by the branch bar (open, approve, merge), by comments that go on
// the PR (commentsStore) and by a protected branch's comment PR (commentsPr). Stateless; never imports a store.
import { HttpError, cachedGet, gh, ghJson, graphql, post } from "../github.ts";

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

// ---- review threads: comments on the PR ----
// GitHub anchors a review comment to a line of the file (a range of lines with start_line), or to the file as a
// whole (subject_type file). Threads, resolution and "outdated" are GraphQL-only.

export type PrComment = { id: number; nodeId: string; author: string; at: string; body: string };
export type PrThread = {
  id: string; // the thread's node id (for resolving)
  path: string;
  line: number | null; // GitHub's current line (1-based), null for a file-level or outdated thread
  startLine: number | null;
  resolved: boolean;
  outdated: boolean; // the commented lines changed since; GitHub keeps the thread but can't place it
  comments: PrComment[]; // the first is the thread's own comment; replies follow
};

const THREADS = `query($owner:String!,$name:String!,$number:Int!,$after:String){
  repository(owner:$owner,name:$name){ pullRequest(number:$number){ reviewThreads(first:100,after:$after){
    pageInfo{ hasNextPage endCursor }
    nodes{ id path line startLine subjectType isResolved isOutdated
      comments(first:100){ nodes{ databaseId id author{ login } createdAt body } } } } } } }`;
type ThreadsJson = {
  repository: {
    pullRequest: {
      reviewThreads: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: {
          id: string;
          path: string;
          line: number | null;
          startLine: number | null;
          subjectType: "LINE" | "FILE";
          isResolved: boolean;
          isOutdated: boolean;
          comments: { nodes: { databaseId: number; id: string; author: { login: string } | null; createdAt: string; body: string }[] };
        }[];
      };
    };
  };
};

// The PR's review threads on `path`, in GitHub's order (oldest first).
export async function prThreads(repo: string, number: number, path: string): Promise<PrThread[]> {
  const [owner, name] = repo.split("/");
  const out: PrThread[] = [];
  for (let after: string | null = null; ; ) {
    const d: ThreadsJson = await graphql<ThreadsJson>(THREADS, { owner, name, number, after });
    const page = d.repository.pullRequest.reviewThreads;
    for (const t of page.nodes) {
      if (t.path !== path) continue;
      const placed = !t.isOutdated && t.subjectType === "LINE"; // a file-level thread says line 1; it isn't on a line
      out.push({
        id: t.id,
        path: t.path,
        line: placed ? t.line : null,
        startLine: placed ? t.startLine : null,
        resolved: t.isResolved,
        outdated: t.isOutdated,
        comments: t.comments.nodes.map((c) => ({ id: c.databaseId, nodeId: c.id, author: c.author?.login ?? "ghost", at: c.createdAt, body: c.body })),
      });
    }
    if (!page.pageInfo.hasNextPage) return out;
    after = page.pageInfo.endCursor;
  }
}

// The lines GitHub lets a comment sit on: GitHub refuses a line outside the PR's diff of the file (changed lines
// and the few context lines around them). Thrown as NotInDiff so the caller can comment on the file instead.
export class NotInDiff extends Error {}

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
    if (/pull_request_review_thread\.(line|start_line|diff_hunk)/.test(text)) throw new NotInDiff(text);
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
