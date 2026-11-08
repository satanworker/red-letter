// The open file: its Session, status, history, and the editor's UI intent (panel tab, active thread, draft comment).
// The CRDT doc isn't copied into the store: `version` ticks (once per frame) when it changes, selectors re-read it.
import type { EditorView } from "@codemirror/view";
import { batch } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { clearComments, commentViaPr, comments, loadComments, refreshComments } from "../comments/commentsStore.ts";
import { addThread, apply, newId, now, plain, remove, reply, sameProse, setResolved, type Edit, type Thread } from "../comments/inline.ts";
import { HttpError, type User } from "../github.ts";
import { branchProtected, commitPatch, fileHistory, type Commit, type RepoInfo } from "../repo/repoService.ts";
import { inCode } from "./commentMarks.ts";
import { selectIcon, type Heading } from "./docSelectors.ts";
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
  shown: { sha: string; patch?: string | null; error?: string } | null; // the History commit opened to its changes (patch: loading while undefined)
  picked: boolean; // the panel tab was chosen; until then it follows what there is to look at
  tab: Tab;
  activeThread: string;
  hoveredThread: string; // the panel card under the pointer: a resolved thread's text lights up only then
  composing: { anchor: Anchor; quote: string } | null;
  showChanges: boolean; // a draft's edits highlighted against its base branch
  drafting: string; // the draft action under way ("Merging…"), one at a time
  draftNote: string; // what the last draft action ended with, if it needs saying
  icons: Record<string, string>; // path -> the doc's icon ("": none), for the branch's docs as last synced or closed
  reading: boolean; // reading mode chosen (the footer's pencil); read-only docs are always read
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
  shown: null,
  picked: false,
  tab: "comments",
  activeThread: "",
  hoveredThread: "",
  composing: null,
  showChanges: false,
  drafting: "",
  draftNote: "",
  icons: {},
  reading: localStorage.getItem("rl_mode") === "reading",
});
export const doc = state;
// The /__figma dev page (src/dev/figma.tsx).
export const fixtureDoc = (s: Partial<DocState>) => set(s);

let view: EditorView | undefined;
// The editor's state (its text is the CRDT's): read after `version` ticks, which a new editor also does.
export const editorState = () => view?.state;
export function setView(v: EditorView | undefined) {
  view = v;
  docChanged();
}

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
// The open file stays on screen until the new one is ready, then the two swap in one update: switching files never
// unmounts the editor's surroundings (panel, header status) or flashes an empty doc.
export async function openFile(repo: RepoInfo, branch: string, path: string, user: User, create?: string, draftOf?: string): Promise<boolean> {
  set({ opening: path, login: user.login });
  document.title = `${path.split("/").pop()} · Red Letter`;
  // a protected branch takes no direct edits; its comments go through a pull request (commentsStore)
  const push = repo.permissions?.push === true;
  const viaPr = push && (await branchProtected(repo.full_name, branch).catch(() => false));
  if (state.opening !== path) return true; // another file was picked meanwhile
  const session = new Session(repo.full_name, repo.node_id, branch, path, push && !viaPr, user.login);
  try {
    await session.open(create, draftOf);
  } catch (e) {
    session.close();
    if (state.opening === path) closeFile();
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
  batch(() => {
    release();
    loadComments(repo.full_name, branch, path, viaPr); // before the editor mounts: it reads comments.viaPr
    set({ session, opening: "", history: [], shown: null, picked: false, tab: "comments", activeThread: "", hoveredThread: "", composing: null, showChanges: false, draftNote: "" });
    pushStatus();
  });
  ticker = window.setInterval(tick, 15_000);
  void navigator.storage?.persist?.(); // ask the browser not to evict this origin's copies under disk pressure
  session.synced.catch((e) => {
    if (e instanceof DocReset && state.session === session) {
      session.log(e.message, "- reopening");
      void openFile(repo, branch, path, user);
    }
  });
  return true;
}

// Leave the open file: its icon goes to the sidebar, the Session leaves live sync (saving if nobody else will).
function release() {
  clearInterval(ticker);
  const s = state.session;
  if (s?.handle) noteIcon(s.path, s.doc.text); // the sidebar keeps an icon set or changed while it was open
  s?.close();
  clearComments();
  historyAt = "";
}

export function closeFile() {
  release();
  set({ session: null, opening: "", status: idle(), history: [], shown: null });
}

// The sidebar's icons: one per doc of the branch, from its text (background sync, closing a doc).
export const noteIcon = (path: string, text: string) => set("icons", path, selectIcon(text)?.icon ?? "");
export const clearIcons = () => set("icons", reconcile({}));

// The tab's favicon: the open doc's icon, else the ¶ from index.html.
const favicon = document.querySelector<HTMLLinkElement>("link[rel=icon]")!;
const defaultFavicon = favicon.href;
export function showFavicon(icon: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${icon}</text></svg>`;
  favicon.href = icon ? `data:image/svg+xml,${encodeURIComponent(svg)}` : defaultFavicon;
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

// A History row opens to the file's changes in that commit (GitHub's diff, cached for good: a sha never changes).
export async function toggleCommit(sha: string) {
  const s = state.session;
  if (!s || state.shown?.sha === sha) return set("shown", null);
  set("shown", { sha, patch: undefined, error: undefined });
  try {
    const patch = await commitPatch(s.repoName, sha, s.path);
    if (state.shown?.sha === sha) set("shown", { sha, patch, error: undefined });
  } catch (e) {
    if (state.shown?.sha === sha) set("shown", { sha, patch: undefined, error: e instanceof Error ? e.message : String(e) });
  }
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
  if (!s || !(s.canWrite || comments.viaPr) || !view || !sel || sel.from === sel.to || inCode(view.state, sel.from) || inCode(view.state, sel.to)) return;
  set("composing", { anchor: s.anchor(sel.from, sel.to), quote: view.state.sliceDoc(sel.from, sel.to) });
}
export const cancelComment = () => set("composing", null);
export const showTab = (tab: Tab) => set({ tab, picked: true });
export const openThread = (id: string) => set({ activeThread: id, tab: "comments", picked: true });
export const closeThread = () => set("activeThread", "");
export const hoverThread = (id: string) => set("hoveredThread", id);
// Reading mode: the markdown rendered and the doc read-only; comments still work.
export const isReading = () => !state.session?.canWrite || state.reading;
export function toggleReading() {
  set("reading", (r) => !r);
  localStorage.setItem("rl_mode", state.reading ? "reading" : "editing");
}

// The doc's markdown without the comment markup, as a copy from the editor gives it.
export const copyContents = () => state.session && navigator.clipboard.writeText(plain(state.session.doc.text).text);

export function jump(from: number, to: number) {
  view?.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
  view?.focus();
}

// Table of contents, measured on Linear's. Each heading has a scroll margin (16px at the top level, 6px deeper); a
// click glides its text to 24px + that margin under the doc's top edge. The reader's section is the last heading
// whose text is within 32px + its margin of that edge (the first before any): 8px of slack, so a clicked heading
// is always the one lit. Over the last 120px of scroll the line slides down to 20px above the viewport's foot, so
// headings too near the end to reach the top still light up one by one, and the last one at the very end.
const tocTop = (h: Heading, scroller: HTMLElement) =>
  view!.lineBlockAt(h.at).top + (h.at ? 12 : 0) + view!.documentTop - scroller.getBoundingClientRect().top; // 12: heading lines' top padding
const tocMargin = (h: Heading) => (h.depth ? 6 : 16);
let glide = { frame: 0, stop: () => {} }; // the table of contents' glide under way
// CodeMirror only estimates the height of lines it hasn't drawn, so the heading's position is read again every frame
// and the glide steers to where it is now; a browser smooth scroll aimed at the first estimate landed hundreds of px
// off in long docs and then needed a second glide. A heading more than a screen away is jumped to first, to a screen
// short of it: gliding the whole way drew every screen in between, a frame or two late each. Any wheel, key or
// pointer press hands the scroll back to the reader.
export function scrollToHeading(h: Heading, scroller: HTMLElement) {
  if (!view) return;
  glide.stop();
  const off = () => tocTop(h, scroller) - 24 - tocMargin(h);
  const screen = scroller.clientHeight, far = off();
  if (Math.abs(far) > screen) scroller.scrollTop += far - Math.sign(far) * screen;
  const from = scroller.scrollTop, start = performance.now();
  let settled = 0;
  const stop = () => {
    cancelAnimationFrame(glide.frame);
    for (const e of ["wheel", "keydown", "pointerdown", "touchstart"]) removeEventListener(e, stop, true);
  };
  for (const e of ["wheel", "keydown", "pointerdown", "touchstart"]) addEventListener(e, stop, true);
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / 250), ease = 1 - (1 - t) ** 3;
    const target = scroller.scrollTop + off(); // where the heading is now, as drawn so far
    const before = scroller.scrollTop;
    scroller.scrollTop = t < 1 ? from + (target - from) * ease : target;
    // done once at the target (or the doc's end, for headings too near it) for a few frames, its lines drawn
    if (t === 1 && (Math.abs(target - before) < 1 || scroller.scrollTop === before)) settled++;
    if (settled < 3 && now - start < 2000) glide.frame = requestAnimationFrame(step);
    else stop();
  };
  glide = { frame: requestAnimationFrame(step), stop };
}
// The reader's section, read in the editor's measure phase, when layout is fresh: read in the scroll event, it made the
// browser lay the page out an extra time per frame. done gets its index.
export function headingInView(hs: Heading[], scroller: HTMLElement, done: (i: number) => void) {
  view?.requestMeasure({
    key: headingInView, // one read per frame however many scroll events
    read: (v) => {
      const left = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      const line = 32 + Math.max(0, 1 - left / 120) * (scroller.clientHeight - 52);
      const len = v.state.doc.length;
      const base = v.documentTop - scroller.getBoundingClientRect().top; // as tocTop, read once
      const above = (h: Heading) => h.at <= len && v.lineBlockAt(h.at).top + (h.at ? 12 : 0) + base - tocMargin(h) <= line;
      // headings are in document order, so the ones above the line come first: binary search for the last of them (a
      // long doc has hundreds)
      let lo = 0, hi = hs.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (above(hs[mid]!)) lo = mid + 1;
        else hi = mid;
      }
      return Math.max(0, lo - 1);
    },
    write: done,
  });
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

// The doc's icon lives in the markdown: an emoji at the start of its first `# ` heading. "" removes it. A doc without
// that heading gets one, titled after the file.
export function setIcon(icon: string) {
  if (!view || !state.session) return;
  const h = selectIcon(view.state.doc);
  if (!h && !icon) return;
  const title = state.session.path.split("/").pop()!.replace(/\.[^.]+$/, "");
  const changes = h ? { from: h.at, to: h.end, insert: icon && `${icon} ` } : { from: 0, insert: `# ${icon} ${title}\n\n` };
  view.dispatch({ changes, userEvent: "input" });
}

export function selectThread(t: Thread) {
  set("activeThread", t.id);
  if (t.range) jump(t.range.from, t.range.to);
}

// ---- comments: edits to the doc (inline.ts), or on a protected branch to its comment PR's copy ----
function editComments(message: string, edits: (text: string) => Edit[], body = "") {
  const s = state.session;
  if (!s) return;
  if (s.canWrite) {
    // no userEvent: not on the undo stack, and commentMarks' guard leaves it alone
    if (view) view.dispatch({ changes: edits(view.state.doc.toString()) });
    return;
  }
  if (!comments.viaPr) return;
  // The PR's copy is about to take in the branch's latest commit: bring the doc there too (a copy from this
  // browser that hasn't caught up yet, a push since the last poll), so the two differ only in comments.
  const caughtUp = s.synced.catch(() => {}).then(() => s.poll(true));
  void commentViaPr(`${message} ${s.path}`, (t) => apply(t, edits(t)), body, caughtUp);
}

export function submitComment(body: string) {
  const s = state.session;
  const c = state.composing;
  set("composing", null);
  const r = s && c && s.resolve(c.anchor);
  if (!s || !c || !r || r.from === r.to) return;
  const id = newId();
  const msg = { author: state.login, at: now(), body };
  editComments("Comment on", (t) => {
    if (s.canWrite) return addThread(t, r.from, r.to, id, msg);
    // the comment PR's copy: the same doc plus comments, so positions correspond through the text without markup;
    // the anchor is resolved again, the doc may have caught up meanwhile
    const at = s.resolve(c.anchor);
    const doc = plain(s.doc.text), pr = plain(t);
    if (!at || at.from === at.to) throw new Error("The commented text is gone");
    if (!sameProse(doc, pr)) throw new Error("The comment PR's copy of this doc differs from it in more than comments");
    return addThread(t, pr.toText(doc.toPlain(at.from), 1), pr.toText(doc.toPlain(at.to), -1), id, msg);
  }, body);
  // the comment shows on the right only now that it's sent (Figma 22:561)
  set({ activeThread: id, tab: "comments", picked: true });
  if (view) {
    view.dispatch({ selection: { anchor: view.state.selection.main.to } });
    view.focus();
  }
}

export const submitReply = (id: string, body: string) => editComments("Reply on", (t) => reply(t, id, { author: state.login, at: now(), body }), body);
export const resolveThread = (id: string) => editComments("Resolve a comment on", (t) => setResolved(t, id, true));
export const reopenThread = (id: string) => editComments("Reopen a comment on", (t) => setResolved(t, id, false));
export const deleteThread = (id: string) => editComments("Delete a comment on", (t) => remove(t, id));

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
