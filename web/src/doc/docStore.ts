// The open file: its Session, status, and the editor's UI intent (panel, tab, active thread, draft comment).
// The CRDT doc isn't copied into the store: `version` ticks (once per frame) when it changes, selectors re-read it.
import type { EditorView } from "@codemirror/view";
import { createStore } from "solid-js/store";
import { addComment, clearComments, loadComments, refreshComments, setResolved } from "../comments/commentsStore.ts";
import type { Comment } from "../comments/commentsService.ts";
import type { Thread } from "../comments/commentsSelectors.ts";
import { HttpError, type User } from "../github.ts";
import type { RepoInfo } from "../repo/repoService.ts";
import { DocReset, Session, type Anchor, type Status } from "./session.ts";
import { cellSelection } from "./tables.ts";

type Tab = "comments" | "changes";
type DocState = {
  session: Session | null;
  opening: string; // path being opened
  login: string;
  status: Status;
  version: number;
  panel: boolean | null; // null = automatic: open when there's something to look at
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
  panel: null,
  tab: "comments",
  activeThread: "",
  composing: null,
  showChanges: false,
  drafting: "",
  draftNote: "",
});
export const doc = state;

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
  set({ opening: path, login: user.login, panel: null, tab: "comments", activeThread: "", composing: null, showChanges: false, draftNote: "" });
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
  const pushStatus = () => set("status", { ...idle(), ...session.status, people: [...session.status.people] });
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
  set({ session: null, opening: "", status: idle() });
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
  set({ composing: { anchor: s.anchor(sel.from, sel.to), quote: view.state.sliceDoc(sel.from, sel.to) }, tab: "comments", panel: true });
}
export const cancelComment = () => set("composing", null);
export const showTab = (tab: Tab) => set({ tab, panel: true });
export const setTab = (tab: Tab) => set("tab", tab);
export const togglePanel = (visible: boolean) => set("panel", !visible);
export const openThread = (id: string) => set({ activeThread: id, tab: "comments", panel: true });

export function jump(from: number, to: number) {
  view?.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
  view?.focus();
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
  set("activeThread", root.id);
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
