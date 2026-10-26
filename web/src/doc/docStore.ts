// The open file: its Session, status, history, and the editor's UI intent (panel tab, active thread, draft comment).
// The CRDT doc isn't copied into the store: `version` ticks (once per frame) when it changes, selectors re-read it.
import type { EditorView } from "@codemirror/view";
import { createStore } from "solid-js/store";
import { addComment, clearComments, loadComments, refreshComments, setResolved } from "../comments/commentsStore.ts";
import type { Comment } from "../comments/commentsService.ts";
import type { Thread } from "../comments/commentsSelectors.ts";
import { HttpError, type User } from "../github.ts";
import { fileHistory, type Commit, type RepoInfo } from "../repo/repoService.ts";
import { DocReset, Session, type Anchor, type Status } from "./session.ts";
import { cellSelection } from "./tables.ts";

type Tab = "comments" | "history";
type DocState = {
  session: Session | null;
  opening: string; // path being opened
  login: string;
  status: Status;
  version: number;
  history: Commit[]; // the commits that touched the file, newest first
  picked: boolean; // the panel tab was chosen; until then it follows what there is to look at
  tab: Tab;
  activeThread: string;
  composing: { anchor: Anchor; quote: string } | null;
  showChanges: boolean; // a draft's edits highlighted against its base branch
  drafting: string; // the draft action under way ("Merging…"), one at a time
  draftNote: string; // what the last draft action ended with, if it needs saying
};

// A fresh object with every key each time: the store merges into the object it holds.
const idle = (): Status => ({ saving: false, dirty: false, error: undefined, commit: "", people: [], online: false, baseHead: "" });
const [state, set] = createStore<DocState>({
  session: null,
  opening: "",
  login: "",
  status: idle(),
  version: 0,
  history: [],
  picked: false,
  tab: "comments",
  activeThread: "",
  composing: null,
  showChanges: false,
  drafting: "",
  draftNote: "",
});
export const doc = state;
// The /__figma dev page (src/dev/figma.tsx).
export const fixtureDoc = (s: Partial<DocState>) => set(s);

let view: EditorView | undefined;
export const setView = (v: EditorView | undefined) => (view = v);

let frame = 0;
export function docChanged() {
  frame ||= requestAnimationFrame(() => {
    frame = 0;
    set("version", (v) => v + 1);
  });
}

let ticker: number | undefined;
export function tick() {
  void state.session?.poll(true);
  void refreshComments();
}

// false: the file doesn't exist on that branch. create: make it, starting with this text.
// draftOf: the branch was just forked from that one as a draft of this file.
export async function openFile(repo: RepoInfo, branch: string, path: string, user: User, create?: string, draftOf?: string): Promise<boolean> {
  closeFile();
  set({ opening: path, login: user.login, picked: false, tab: "comments", activeThread: "", composing: null, showChanges: false, draftNote: "" });
  document.title = `${path.split("/").pop()} · Red Letter`;
  const session = new Session(repo.full_name, repo.node_id, branch, path, repo.permissions?.push === true, user.login);
  try {
    await session.open(create, draftOf);
  } catch (e) {
    session.close();
    if (state.opening === path) set("opening", "");
    if (e instanceof HttpError && e.status === 404) return false;
    throw e;
  }
  if (state.opening !== path) {
    session.close(); // another file was picked meanwhile
    return true;
  }
  const pushStatus = () => {
    set("status", { ...idle(), ...session.status, people: [...session.status.people] });
    void loadHistory(session);
  };
  session.onStatus = () => {
    pushStatus();
    docChanged();
  };
  session.handle.on("change", docChanged);
  set({ session, opening: "" });
  pushStatus();
  ticker = window.setInterval(tick, 15_000);
  void loadComments(repo.full_name, branch, path);
  void navigator.storage?.persist?.(); // ask the browser not to evict this origin's copies under disk pressure
  session.synced.catch((e) => {
    if (e instanceof DocReset && state.session === session) {
      session.log(e.message, "- reopening");
      void openFile(repo, branch, path, user);
    }
  });
  return true;
}

export function closeFile() {
  clearInterval(ticker);
  state.session?.close();
  clearComments();
  historyAt = "";
  set({ session: null, opening: "", status: idle(), history: [] });
}

// Refetched whenever the doc's commit moves (a save, a replayed push); keyed by that sha, so asking again is free.
let historyAt = "";
async function loadHistory(s: Session) {
  const at = s.status.commit;
  if (!at || at === historyAt) return;
  historyAt = at;
  const list = await fileHistory(s.repoName, at, s.path).catch((e) => (s.log("history:", String(e)), null));
  if (list && state.session === s && historyAt === at) set("history", list);
}

// beforeunload: unsaved text and nobody else here to save it -> save now and ask the browser to hold the page
export function leavingWithUnsaved(): boolean {
  const s = state.session;
  if (!s?.canWrite || !s.status.dirty || s.status.people.length) return false;
  void s.save();
  return true;
}

// ---- editor UI ----
export function startComment() {
  const s = state.session;
  const sel = view && (view.state.field(cellSelection) ?? view.state.selection.main);
  if (!s?.canWrite || !view || !sel || sel.from === sel.to) return;
  set("composing", { anchor: s.anchor(sel.from, sel.to), quote: view.state.sliceDoc(sel.from, sel.to) });
}
export const cancelComment = () => set("composing", null);
export const showTab = (tab: Tab) => set({ tab, picked: true });
export const openThread = (id: string) => set({ activeThread: id, tab: "comments", picked: true });

export function jump(from: number, to: number) {
  view?.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
  view?.focus();
}

// Pasted or dropped image files: uploaded to git as blobs, then linked where they landed (that spot follows edits
// made meanwhile). The next save commits them next to the file.
export async function insertImages(files: File[], pos: number) {
  const s = state.session;
  if (!s) return;
  const at = s.anchor(pos, pos);
  const srcs = await Promise.all(files.map((f) => s.addImage(f)));
  const links = files.flatMap((f, i) => (srcs[i] ? [`![${f.name.replace(/\.\w+$/, "").replace(/[[\]]/g, "")}](${srcs[i]})`] : []));
  const p = s.resolve(at)?.from;
  if (!view || state.session !== s || !links.length || p === undefined) return; // switched files meanwhile
  const from = Math.min(p, view.state.doc.length); // the editor may be a frame behind the doc
  const line = view.state.doc.lineAt(from); // each picture on a line of its own
  const insert = (from > line.from ? "\n" : "") + links.join("\n") + (from < line.to ? "\n" : "");
  view.dispatch({ changes: { from, insert }, selection: { anchor: from + insert.length }, userEvent: "input.paste" });
}

export function selectThread(t: Thread) {
  set("activeThread", t.root.id);
  if (t.range) jump(t.range.from, t.range.to);
}

// ---- comments (shown at once; commentsStore writes them in the background) ----
export function submitComment(body: string) {
  const s = state.session;
  const c = state.composing;
  if (!s || !c) return;
  set("composing", null);
  const root: Comment = { id: crypto.randomUUID(), author: state.login, body, createdAt: new Date().toISOString(), docId: s.docId, ...c.anchor, quote: c.quote };
  addComment(root);
  // the comment shows on the right only now that it's sent (Figma 22:561)
  set({ activeThread: root.id, tab: "comments", picked: true });
  if (view) {
    view.dispatch({ selection: { anchor: view.state.selection.main.to } });
    view.focus();
  }
}

export function submitReply(rootId: string, body: string) {
  addComment({ id: crypto.randomUUID(), parent: rootId, author: state.login, body, createdAt: new Date().toISOString() });
}

export const toggleResolved = (root: Comment) => setResolved(root.id, !root.resolved);

// ---- drafts ----
export const toggleChanges = () => set("showChanges", (v) => !v);
export const noteDraft = (note: string) => set("draftNote", note);

// One draft action at a time on the open draft; an error ends up in draftNote. undefined: it didn't finish.
export async function runDraft<T>(busy: string, action: (s: Session) => Promise<T>): Promise<T | undefined> {
  const s = state.session;
  if (!s?.doc.base || state.drafting) return;
  set({ drafting: busy, draftNote: "" });
  try {
    return await action(s);
  } catch (e) {
    set("draftNote", e instanceof Error ? e.message : String(e));
  } finally {
    set("drafting", "");
  }
}

export const updateDraft = () => runDraft("Updating…", (s) => s.updateFromBase());
