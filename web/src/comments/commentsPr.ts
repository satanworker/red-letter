// A protected branch takes no direct commits, so its docs get comments through one pull request per doc, from the
// branch red-letter/comments/<sha1(branch)>/<sha1(path)>: the doc plus the comment markup (inline.ts). Merging the PR
// lands the comments; they are HTML comments, so the rendered page doesn't change.
import { HttpError, b64, cachedGet, encPath, gh, post, sha1, unb64 } from "../github.ts";
import { openPr, openPrFrom, type Pr } from "../repo/pulls.ts";

export type { Pr };

// Hashed: a path isn't always a valid ref name (".devcontainer/x", "a b.md"), and "<branch>/<path>" collides.
const commentBranch = async (branch: string, path: string) => `red-letter/comments/${await sha1(branch)}/${await sha1(path)}`;

// The doc's open comment PR and the doc's text on its branch; null when none is open.
export async function readPr(repo: string, branch: string, path: string): Promise<{ pr: Pr; text: string } | null> {
  const head = await commentBranch(branch, path);
  const pr = await openPrFrom(repo, head, branch);
  if (!pr) return null;
  const text = await cachedGet(`/repos/${repo}/contents/${encPath(path)}?ref=${encodeURIComponent(head)}`, { raw: true, fresh: true });
  return { pr, text: text.replaceAll("\r\n", "\n") };
}

// Commits edit(the doc on the comment branch) to it, opening the PR if none is open. With no open PR the branch
// starts over from the doc's branch; otherwise the doc's branch is merged into it first, so the PR's copy is current.
export async function commitToPr(repo: string, branch: string, path: string, message: string, edit: (text: string) => string): Promise<{ pr: Pr; text: string }> {
  const head = await commentBranch(branch, path);
  const ref = `/repos/${repo}/git/refs/heads/${encPath(head)}`;
  let pr = await openPrFrom(repo, head, branch);
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
  const body = `Comments on \`${path}\` from Red Letter, for \`${branch}\`, which is protected. They're HTML comments: merging changes nothing in the rendered page. The threads are at the end of the file.`;
  return { pr: await openPr(repo, head, branch, `Comments on ${path}`, body), text };
}
