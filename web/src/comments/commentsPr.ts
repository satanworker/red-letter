// A protected branch takes no direct commits, so its docs get comments through one pull request per doc, from the
// branch red-letter/comments/<branch>/<path>: the doc plus the comment markup (inline.ts). Merging the PR lands the
// comments; they are HTML comments, so the rendered page doesn't change.
import { HttpError, b64, cachedGet, encPath, gh, ghJson, post, unb64 } from "../github.ts";

export type Pr = { number: number; url: string };
type PrJson = { number: number; html_url: string };

// ponytail: branch "a" + path "b/c.md" and branch "a/b" + path "c.md" share a comment branch; hash it if it ever matters
const commentBranch = (branch: string, path: string) => `red-letter/comments/${branch}/${path}`;

// Always asked of GitHub (an unchanged answer is a free 304): a shared in-flight request or a recent answer can
// predate a comment just written, and would take it off the panel.
async function openPrOf(repo: string, branch: string, head: string): Promise<Pr | null> {
  const q = `state=open&base=${encodeURIComponent(branch)}&head=${encodeURIComponent(`${repo.split("/")[0]}:${head}`)}`;
  const [p]: PrJson[] = JSON.parse(await cachedGet(`/repos/${repo}/pulls?${q}`, { fresh: true }));
  return p ? { number: p.number, url: p.html_url } : null;
}

// The doc's open comment PR and the doc's text on its branch; null when none is open.
export async function readPr(repo: string, branch: string, path: string): Promise<{ pr: Pr; text: string } | null> {
  const head = commentBranch(branch, path);
  const pr = await openPrOf(repo, branch, head);
  if (!pr) return null;
  const text = await cachedGet(`/repos/${repo}/contents/${encPath(path)}?ref=${encodeURIComponent(head)}`, { raw: true, fresh: true });
  return { pr, text: text.replaceAll("\r\n", "\n") };
}

// Commits edit(the doc on the comment branch) to it, opening the PR if none is open. With no open PR the branch
// starts over from the doc's branch; otherwise the doc's branch is merged into it first, so the PR's copy is current.
export async function commitToPr(repo: string, branch: string, path: string, message: string, edit: (text: string) => string): Promise<{ pr: Pr; text: string }> {
  const head = commentBranch(branch, path);
  const ref = `/repos/${repo}/git/refs/heads/${encPath(head)}`;
  let pr = await openPrOf(repo, branch, head);
  if (!pr) {
    const base: { object: { sha: string } } = JSON.parse(await cachedGet(`/repos/${repo}/git/ref/heads/${encPath(branch)}`, { fresh: true }));
    const sha = base.object.sha;
    const res = await gh(ref, { method: "PATCH", body: JSON.stringify({ sha, force: true }) });
    if (res.status === 422 || res.status === 404) await post(`/repos/${repo}/git/refs`, { ref: `refs/heads/${head}`, sha });
    else if (!res.ok) throw new HttpError(res.status, `resetting ${head}: ${res.status} ${await res.text()}`);
  } else {
    const res = await gh(`/repos/${repo}/merges`, { method: "POST", body: JSON.stringify({ base: head, head: branch, commit_message: `Merge ${branch} into the comments on ${path}` }) });
    if (res.status === 409) throw new Error(`The comment PR #${pr.number} conflicts with ${branch}: resolve it on GitHub`);
    if (!res.ok) throw new HttpError(res.status, `updating ${head}: ${res.status} ${await res.text()}`);
  }
  let text = "";
  for (let attempt = 1; ; attempt++) {
    const file: { sha: string; content: string } = JSON.parse(await cachedGet(`/repos/${repo}/contents/${encPath(path)}?ref=${encodeURIComponent(head)}`, { fresh: true }));
    const raw = new TextDecoder().decode(unb64(file.content));
    const crlf = raw.includes("\r\n");
    text = edit(raw.replaceAll("\r\n", "\n"));
    const content = b64(new TextEncoder().encode(crlf ? text.replaceAll("\n", "\r\n") : text));
    const res = await gh(`/repos/${repo}/contents/${encPath(path)}`, { method: "PUT", body: JSON.stringify({ message, content, sha: file.sha, branch: head }) });
    if (res.ok) break;
    if (res.status !== 409 || attempt >= 3) throw new HttpError(res.status, `saving the comment: ${res.status} ${await res.text()}`);
  }
  if (pr) return { pr, text };
  const p = await ghJson<PrJson>(`/repos/${repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: `Comments on ${path}`,
      head,
      base: branch,
      body: `Comments on \`${path}\` from Red Letter, for \`${branch}\`, which is protected. They're HTML comments: merging changes nothing in the rendered page. The threads are at the end of the file.`,
    }),
  });
  return { pr: { number: p.number, url: p.html_url }, text };
}
