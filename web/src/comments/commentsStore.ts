// Comments of the open file, optimistic: a new comment, reply or resolve shows at once and is written to the
// comments branch in the background, one at a time, in order. Pending writes and the last list GitHub returned
// are kept in IndexedDB, so a reload or going offline loses nothing and the list shows before any request.
import { createStore } from "solid-js/store";
import { idbGet, idbPut } from "../idb.ts";
import { Comments, type Comment } from "./commentsService.ts";

type Op = { kind: "add"; comment: Comment } | { kind: "resolve"; id: string; resolved: boolean };
type Saved = { confirmed: Comment[]; ops: Op[] };
type File = { service: Comments; key: string; path: string; saved: Saved; error: string; flushing?: Promise<void> };

const [state, set] = createStore({ list: [] as Comment[], file: "", sending: [] as string[], error: "" });
export const comments = state;
let cur: File | null = null;

// Idempotent, so applying an op that GitHub already has (a refresh raced the write) changes nothing.
const apply = (list: Comment[], op: Op): Comment[] =>
  op.kind === "add"
    ? list.some((c) => c.id === op.comment.id)
      ? list
      : [...list, op.comment]
    : list.map((c) => (c.id === op.id ? { ...c, resolved: op.resolved } : c));

const describe = (op: Op, path: string) =>
  op.kind === "resolve" ? `${op.resolved ? "Resolve" : "Reopen"} comment on ${path}` : `${op.comment.parent ? "Reply" : "Comment"} on ${path}`;

const keyOf = (repoName: string, file: string) => `comments ${repoName.toLowerCase()} ${file}`;

function render() {
  const f = cur;
  if (!f) return set({ list: [], file: "", sending: [], error: "" });
  const sending = f.saved.ops.flatMap((op) => (op.kind === "add" ? [op.comment.id] : []));
  set({ list: f.saved.ops.reduce(apply, f.saved.confirmed), file: f.service.file, sending, error: f.error });
}

export async function loadComments(repoName: string, branch: string, path: string) {
  const service = new Comments(repoName, branch, path);
  const key = keyOf(repoName, service.file);
  const f: File = { service, key, path, saved: { confirmed: [], ops: [] }, error: "" };
  cur = f;
  render();
  f.saved = (await idbGet<Saved>("docs", key)) ?? f.saved;
  if (cur !== f) return;
  render();
  await refreshComments();
}

export function clearComments() {
  cur = null;
  render();
}

// Also retries writes that failed (offline, a lost race): the 15 s tick and window focus land here.
export async function refreshComments() {
  const f = cur;
  if (!f) return;
  if (await f.service.refresh().catch(() => false)) {
    f.saved.confirmed = f.service.list;
    void idbPut("docs", f.key, f.saved);
    if (f === cur) render();
  }
  void flush(f);
}

function queue(op: Op) {
  const f = cur;
  if (!f) return;
  f.saved.ops.push(op);
  void idbPut("docs", f.key, f.saved);
  render();
  void flush(f);
}

// Writes queued ops in order. Stops at the first failure and keeps it queued; the next refresh retries.
function flush(f: File): Promise<void> {
  return (f.flushing ??= (async () => {
    while (f.saved.ops.length) {
      const op = f.saved.ops[0];
      try {
        await f.service.mutate(describe(op, f.path), (l) => apply(l, op));
        f.saved.ops.shift();
        f.saved.confirmed = f.service.list;
        f.error = "";
      } catch (e) {
        f.error = e instanceof TypeError ? "can't reach GitHub" : e instanceof Error ? e.message : String(e);
        break;
      } finally {
        void idbPut("docs", f.key, f.saved);
        if (f === cur) render();
      }
    }
  })().finally(() => (f.flushing = undefined)));
}

export const addComment = (comment: Comment) => queue({ kind: "add", comment });
export const setResolved = (id: string, resolved: boolean) => queue({ kind: "resolve", id, resolved });

// Background sync: store a file's list as of `head` so opening it shows comments at once.
export async function warmComments(repoName: string, branch: string, path: string, head: string) {
  const service = new Comments(repoName, branch, path);
  const key = keyOf(repoName, service.file);
  if (cur?.key === key) return;
  const saved = await idbGet<Saved>("docs", key);
  if (saved?.ops.length) return; // unsent writes: the file's own flush owns this record
  await service.loadAt(head);
  if (cur?.key !== key) await idbPut("docs", key, { confirmed: service.list, ops: [] } satisfies Saved);
}
