// Routes, editor, side panel. Plain DOM; CodeMirror 6 (live preview) bound to the Automerge text.
import { automergeSyncPlugin, type DocHandle as PluginHandle } from "@automerge/automerge-codemirror";
import { EditorState, StateEffect, StateField, Transaction, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, showTooltip, type DecorationSet, type Tooltip } from "@codemirror/view";
import { Comments, type Comment } from "./comments.ts";
import { Session, type Anchor, type RLDoc } from "./doc.ts";
import { editorExtensions } from "./livePreview.ts";
import {
  APP_SLUG,
  HttpError,
  authKind,
  completeSignIn,
  currentUser,
  encPath,
  gh,
  ghJson,
  rememberReturn,
  signIn,
  signOut,
  token,
  type User,
} from "./github.ts";

const app = document.getElementById("app")!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function h(html: string): HTMLElement {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}
const avatar = (login: string, size = 24) =>
  `<img class="av" width="${size}" height="${size}" src="https://github.com/${encodeURIComponent(login)}.png?size=${size * 2}" alt="${esc(login)}" title="${esc(login)}">`;
// Git commit authors are names, not GitHub logins: show an initial instead of guessing an avatar.
const initial = (name: string, size = 22) =>
  `<span class="av initial" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.5)}px" title="${esc(name)}">${esc((name.trim()[0] ?? "?").toUpperCase())}</span>`;
const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
};
const LOGO = `<a href="/" class="logo"><span class="pilcrow">¶</span> Red Letter</a>`;

// ---------------------------------------------------------------- icons (inline SVG, currentColor)
const svg = (d: string, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const commentIcon = svg(`<path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/>`);
const checkIcon = svg(`<path d="M3.5 8.5l3 3 6-7"/>`, 14);
const branchIcon = svg(`<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="5.5" r="1.5"/><path d="M4.5 5v6M11.5 7c0 2.5-7 1.5-7 4"/>`, 12);
const githubMark = `<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;

export function start() {
  route().catch((e) => fatal(e instanceof Error ? e.message : String(e)));
}

function fatal(msg: string) {
  app.replaceChildren(h(`<div class="screen"><div class="card-lg"><h1>Something went wrong</h1><p class="err">${esc(msg)}</p><p><a href="/">Back home</a></p></div></div>`));
}

async function route(): Promise<void> {
  if (location.pathname === "/auth/callback") {
    history.replaceState(null, "", await completeSignIn());
    return route();
  }
  const m = location.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  if (!m) return landing();
  if (!(await token())) return signInScreen(`Sign in to open <b>${esc(m[3].split("/").pop() ?? "")}</b> from ${esc(m[1])}/${esc(m[2])}.`);
  return openFile(m[1], m[2], m[3].split("/").map(decodeURIComponent));
}

// ---------------------------------------------------------------- screens
const signInButtons = `
  <button class="btn primary big" data-signin="oauth">${githubMark} Continue with GitHub</button>
  <p class="fine">One click, works on every repo you can already access.
    Prefer to pick repositories? <a href="#" data-signin="app">Use the GitHub App instead</a>.</p>`;
function wireSignIn(el: HTMLElement) {
  for (const b of el.querySelectorAll<HTMLElement>("[data-signin]"))
    b.addEventListener("click", (e) => {
      e.preventDefault();
      void signIn(b.dataset.signin === "app" ? "app" : "oauth");
    });
}

async function landing() {
  const user = await currentUser().catch(() => null);
  const el = h(`<div class="screen">
    <nav class="topnav">${LOGO}<span class="spacer"></span>${user ? `${avatar(user.login)} <a href="#" id="out" class="muted">Sign out</a>` : ""}</nav>
    <div class="hero">
      <h1>Write together.<br><span class="red">Agents included.</span></h1>
      <p class="lede">Open any markdown file from GitHub, edit it live with your team, and leave comments in the margin.
        Your agents keep using <code>git push</code>; their changes show up here, ready to review.</p>
      <form class="open"><input name="u" placeholder="Paste a GitHub file link: github.com/owner/repo/blob/main/README.md" autofocus><button class="btn primary">Open</button></form>
      <p class="fine">Or swap <code>github.com</code> for <code>${esc(location.host)}</code> in any file URL.</p>
      ${user ? "" : `<div class="signin">${signInButtons}</div>`}
    </div>
  </div>`);
  el.querySelector("form")!.onsubmit = (e) => {
    e.preventDefault();
    const u = (el.querySelector("input") as HTMLInputElement).value.trim();
    const path = u.replace(/^(https?:\/\/)?(www\.)?github\.com/, "").replace(/^https?:\/\/[^/]+/, "");
    location.assign(path.startsWith("/") ? path : `/${path}`);
  };
  wireSignIn(el);
  el.querySelector<HTMLElement>("#out")?.addEventListener("click", (e) => {
    e.preventDefault();
    signOut();
    void landing();
  });
  app.replaceChildren(el);
}

function signInScreen(why: string) {
  const el = h(`<div class="screen"><nav class="topnav">${LOGO}</nav><div class="card-lg"><h1>Sign in</h1><p>${why}</p>${signInButtons}</div></div>`);
  wireSignIn(el);
  app.replaceChildren(el);
}

function noAccessScreen(owner: string, repo: string) {
  const viaApp = authKind() === "app";
  const el = h(`<div class="screen"><nav class="topnav">${LOGO}</nav><div class="card-lg">
    <h1>${viaApp ? "Install Red Letter on this repo" : "No access to this repo"}</h1>
    ${
      viaApp
        ? `<p>You signed in with the GitHub App, which only reaches repositories it's installed on. <b>${esc(owner)}/${esc(repo)}</b> isn't one of them yet.</p>
           <p><button class="btn primary" id="install">Install on ${esc(owner)}</button></p>
           <p class="fine">Don't own it? Ask the owner, or <a href="#" data-signin="oauth">continue with plain GitHub sign-in</a> instead.</p>`
        : `<p>Your GitHub account can't see <b>${esc(owner)}/${esc(repo)}</b>. If it belongs to an organization, an owner may need to approve Red Letter under the org's third-party access settings, or you can <a href="#" data-signin="app">use the GitHub App</a>.</p>`
    }</div></div>`);
  el.querySelector<HTMLElement>("#install")?.addEventListener("click", () => {
    rememberReturn();
    location.assign(`https://github.com/apps/${APP_SLUG}/installations/new`);
  });
  wireSignIn(el);
  app.replaceChildren(el);
}

async function appInstalledOn(fullName: string): Promise<boolean> {
  const owner = fullName.split("/")[0].toLowerCase();
  type Inst = { id: number; account: { login: string }; repository_selection: "all" | "selected" };
  const { installations } = await ghJson<{ installations: Inst[] }>("/user/installations?per_page=100");
  const inst = installations.find((i) => i.account.login.toLowerCase() === owner);
  if (!inst) return false;
  if (inst.repository_selection === "all") return true;
  // ponytail: first 100 selected repos only
  const { repositories } = await ghJson<{ repositories: { full_name: string }[] }>(`/user/installations/${inst.id}/repositories?per_page=100`);
  return repositories.some((r) => r.full_name.toLowerCase() === fullName.toLowerCase());
}

// ---------------------------------------------------------------- open a file
async function openFile(owner: string, repo: string, rest: string[]) {
  app.replaceChildren(h(`<div class="loading"><div class="spinner"></div>Opening ${esc(rest.at(-1) ?? "")}…</div>`));
  const repoName = `${owner}/${repo}`;
  const info = await ghJson<{ node_id: string; full_name: string; permissions?: { push: boolean } }>(`/repos/${repoName}`).catch((e) => {
    if (e instanceof HttpError && (e.status === 404 || e.status === 403)) return null;
    throw e;
  });
  if (!info) return noAccessScreen(owner, repo);
  // A GitHub App token can only write where the App is installed; public repos read fine without it, so check.
  if (authKind() === "app" && info.permissions?.push && !(await appInstalledOn(info.full_name))) return noAccessScreen(owner, repo);
  // branch names may contain "/": try the shortest prefix that is a branch, like GitHub does
  let branch = "";
  for (let i = 1; i < rest.length && !branch; i++) {
    const cand = rest.slice(0, i).join("/");
    if ((await gh(`/repos/${info.full_name}/git/ref/heads/${encPath(cand)}`)).ok) branch = cand;
  }
  if (!branch) throw new Error(`No branch found in ${rest.join("/")}`);
  const path = rest.slice(branch.split("/").length).join("/");
  const user = (await currentUser())!;
  const canWrite = info.permissions?.push === true;
  const session = new Session(info.full_name, info.node_id, branch, path, canWrite, user.login);
  await session.open();
  const comments = new Comments(info.full_name, branch, path);
  await comments.refresh().catch(() => {});
  editorScreen(session, comments, user);
}

// ---------------------------------------------------------------- editor
class DelWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(o: DelWidget) {
    return o.text === this.text;
  }
  toDOM() {
    const el = document.createElement("del");
    el.className = "rl-del";
    el.textContent = this.text;
    el.title = "removed by the agent";
    return el;
  }
}

const setDecos = StateEffect.define<DecorationSet>();
const decoField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(d, tr) {
    d = d.map(tr.changes);
    for (const e of tr.effects) if (e.is(setDecos)) d = e.value;
    return d;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// Remote changes (peers, agent replays) must not land on the local undo stack: one Ctrl-Z must never revert
// someone else's edit. The automerge binding dispatches them without a userEvent; local typing always has one.
const remoteNotUndoable = EditorState.transactionExtender.of((tr) =>
  tr.docChanged && !tr.annotation(Transaction.userEvent) ? { annotations: Transaction.addToHistory.of(false) } : null,
);

// Notion-style floating "Comment" button above a non-empty selection.
function commentTooltip(onComment: () => void) {
  const make = (state: EditorState): Tooltip | null => {
    const sel = state.selection.main;
    if (sel.empty) return null;
    return {
      pos: sel.from,
      end: sel.to,
      above: true,
      create: () => {
        const dom = h(`<div class="sel-tip"><button>${commentIcon} Comment</button></div>`);
        dom.querySelector("button")!.onmousedown = (e) => {
          e.preventDefault(); // keep the editor selection
          onComment();
        };
        return { dom };
      },
    };
  };
  return StateField.define<Tooltip | null>({
    create: make,
    update: (t, tr) => (tr.docChanged || tr.selection ? make(tr.state) : t),
    provide: (f) => showTooltip.from(f),
  });
}

type Thread = { root: Comment; replies: Comment[]; range: { from: number; to: number } | null; moved: boolean };

function editorScreen(session: Session, comments: Comments, user: User) {
  const { repoName, branch, path, canWrite } = session;
  const [owner, repo] = repoName.split("/");
  const file = path.split("/").pop()!;
  const el = h(`<div class="editor-screen">
    <header>
      ${LOGO}
      <span class="crumbs">
        <a href="https://github.com/${esc(repoName)}" target="_blank" class="crumb">${esc(owner)}</a><span class="sep">/</span>
        <a href="https://github.com/${esc(repoName)}/tree/${encPath(branch)}" target="_blank" class="crumb">${esc(repo)}</a><span class="sep">/</span>
        <a href="https://github.com/${esc(repoName)}/blob/${encPath(branch)}/${encPath(path)}" target="_blank" class="crumb file" title="${esc(path)}">${esc(file)}</a>
        <span class="pill" title="branch">${branchIcon}${esc(branch)}</span>
        ${canWrite ? "" : `<span class="pill">read-only</span>`}
      </span>
      <span class="spacer"></span>
      <span id="status" class="status"></span>
      <span id="people" class="people"></span>
      <button class="btn ghost" id="b-share">Share</button>
      <button class="btn ghost icon" id="b-panel" title="Comments and changes">${commentIcon}<span id="count"></span></button>
      <span class="me">${avatar(user.login, 26)}</span>
    </header>
    <main>
      <div id="doc"><div id="banner"></div><div id="editor"></div></div>
      <aside id="panel" hidden>
        <div class="tabs"><button data-tab="comments">Comments</button><button data-tab="changes">Agent changes</button></div>
        <div id="changes"></div><div id="comments"></div>
      </aside>
    </main>
  </div>`);
  app.replaceChildren(el);
  document.title = `${file} · Red Letter`;
  const $ = (id: string) => el.querySelector<HTMLElement>(`#${id}`)!;

  let composing: { anchor: Anchor; quote: string } | null = null;
  let activeThread = "";
  let tab: "comments" | "changes" = "comments";
  let panelOpen: boolean | null = null; // null = automatic (open when there's something to look at)

  const startComment = () => {
    const sel = view.state.selection.main;
    if (sel.empty || !canWrite) return;
    composing = { anchor: session.anchor(sel.from, sel.to), quote: view.state.sliceDoc(sel.from, sel.to) };
    tab = "comments";
    panelOpen = true;
    refresh();
    // the panel renders on the next frame
    requestAnimationFrame(() => requestAnimationFrame(() => el.querySelector<HTMLElement>('[data-draft="new"]')?.focus()));
  };

  // automerge-repo's handle.doc() may be undefined before ready; it is ready here
  const handle = session.handle as unknown as PluginHandle<RLDoc>;
  const view = new EditorView({
    doc: session.doc.text,
    extensions: [
      ...editorExtensions(),
      decoField,
      remoteNotUndoable,
      EditorState.readOnly.of(!canWrite),
      canWrite ? commentTooltip(startComment) : [],
      keymap.of([
        { key: "Mod-s", preventDefault: true, run: () => (void session.save(), true) },
        { key: "Mod-Alt-m", preventDefault: true, run: () => (startComment(), true) },
      ]),
      automergeSyncPlugin({ handle, path: ["text"] }),
    ],
    parent: $("editor"),
  });

  // ---- render loop (coalesced per frame) ----
  let queued = false;
  const refresh = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      renderStatus();
      if (view.state.doc.length !== session.doc.text.length) return refresh(); // binding hasn't caught up yet
      const threads = buildThreads();
      renderDecorations(threads);
      renderPanel(threads);
    });
  };

  function renderStatus() {
    const s = session.status;
    const commit = `<a href="https://github.com/${esc(repoName)}/commit/${s.commit}" target="_blank" title="Last commit on ${esc(branch)}">${s.commit.slice(0, 7)}</a>`;
    const state = s.saving ? "Saving…" : s.dirty ? "Edited" : `Saved · ${commit}`;
    const live = canWrite && !s.online ? ` · <span class="warn" title="Live sync is reconnecting; edits are kept and saved to git">offline</span>` : "";
    $("status").innerHTML = state + live + (s.error ? ` · <span class="err" title="${esc(s.error)}">error</span>` : "");
    const people = [...new Set(s.people)];
    $("people").innerHTML = people.map((p) => avatar(p, 24)).join("");
    $("people").title = people.length ? `Also here: ${people.join(", ")}` : "";
  }

  function buildThreads(): Thread[] {
    const text = session.doc.text;
    return comments.list
      .filter((c) => !c.parent)
      .map((root) => {
        let range: Thread["range"] = null;
        if (root.docId === session.docId && root.from && root.to) range = session.resolve({ from: root.from, to: root.to });
        if (!range && root.quote) {
          const i = text.indexOf(root.quote);
          if (i >= 0) range = { from: i, to: i + root.quote.length };
        }
        const moved = !!range && !!root.quote && text.slice(range.from, range.to) !== root.quote;
        return { root, replies: comments.list.filter((c) => c.parent === root.id), range, moved };
      })
      .sort((a, b) => (a.range?.from ?? Infinity) - (b.range?.from ?? Infinity));
  }

  function renderDecorations(threads: Thread[]) {
    const len = view.state.doc.length;
    const out: Range<Decoration>[] = [];
    const mark = (from: number, to: number, cls: string, attrs?: Record<string, string>) => {
      from = Math.min(from, len);
      to = Math.min(to, len);
      if (to > from) out.push(Decoration.mark({ class: cls, attributes: attrs }).range(from, to));
    };
    for (const m of Object.values(session.doc.marks ?? {})) {
      for (const hk of m.hunks) {
        const r = session.resolve(hk);
        if (!r) continue;
        if (hk.before) out.push(Decoration.widget({ widget: new DelWidget(hk.before), side: -1 }).range(Math.min(r.from, len)));
        mark(r.from, r.to, "rl-agent", { title: `${m.author}: ${m.message}` });
      }
      for (const c of m.conflicts) {
        const r = session.resolve(c);
        if (r) mark(r.from, r.to, "rl-conflict", { title: "You and the agent both edited this. Pick a version in the panel." });
      }
    }
    for (const t of threads)
      if (t.range && !t.root.resolved) mark(t.range.from, t.range.to, t.root.id === activeThread ? "rl-comment active" : "rl-comment", { "data-thread": t.root.id });
    view.dispatch({ effects: setDecos.of(Decoration.set(out, true)) });
  }

  function jump(from: number, to: number) {
    view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    view.focus();
  }

  function renderPanel(threads: Thread[]) {
    const marks = Object.values(session.doc.marks ?? {}).sort((a, b) => a.at.localeCompare(b.at));
    const open = threads.filter((t) => !t.root.resolved);
    const conflicts = marks.reduce((n, m) => n + m.conflicts.length, 0);
    // banner over the document: agent work waiting for review
    $("banner").innerHTML = marks.length
      ? `<div class="banner${conflicts ? " bad" : ""}">${initial(marks.at(-1)!.author, 20)}
          <span><b>${esc(marks.at(-1)!.author)}</b> pushed ${marks.length > 1 ? `${marks.length} commits` : "changes"}${conflicts ? ` · <b>${conflicts} need${conflicts > 1 ? "" : "s"} a decision</b>` : ""}</span>
          <button class="btn ghost small" data-review>Review</button></div>`
      : "";
    $("banner").querySelector<HTMLElement>("[data-review]")?.addEventListener("click", () => {
      tab = "changes";
      panelOpen = true;
      refresh();
    });
    const auto = open.length > 0 || marks.length > 0 || !!composing;
    const visible = panelOpen ?? auto;
    $("panel").hidden = !visible;
    $("count").textContent = open.length ? String(open.length) : "";
    if (!visible) return;
    if (tab === "changes" && !marks.length && (open.length || composing)) tab = "comments";
    if (tab === "comments" && !open.length && !composing && marks.length && panelOpen === null) tab = "changes";
    for (const b of el.querySelectorAll<HTMLElement>("[data-tab]")) {
      b.classList.toggle("on", b.dataset.tab === tab);
      b.innerHTML = b.dataset.tab === "comments" ? `Comments${open.length ? ` <i>${open.length}</i>` : ""}` : `Agent changes${marks.length ? ` <i>${marks.length}</i>` : ""}`;
    }
    $("changes").hidden = tab !== "changes";
    $("comments").hidden = tab !== "comments";
    if (tab === "changes") renderChanges(marks);
    else renderComments(threads);
  }

  function renderChanges(marks: NonNullable<RLDoc["marks"]>[string][]) {
    const box = $("changes");
    if (!marks.length) return box.replaceChildren(h(`<p class="empty">No agent changes waiting for review. Commits pushed with git show up here.</p>`));
    const text = session.doc.text;
    box.replaceChildren(
      ...marks.map((m) => {
        const card = h(`<div class="card">
          <div class="who">${initial(m.author, 22)}<div><b>${esc(m.author)}</b><div class="meta">${ago(m.at)} · <a href="https://github.com/${esc(repoName)}/commit/${m.sha}" target="_blank">${m.sha.slice(0, 7)}</a></div></div></div>
          <div class="msg">${esc(m.message)}</div></div>`);
        m.conflicts.forEach((c, i) => {
          const r = session.resolve(c);
          const row = h(`<div class="hunk conflict"><div class="label">⚠ You both edited this</div><q>${esc(r ? text.slice(r.from, r.to).slice(0, 80) : "")}</q>
            ${canWrite && c.human !== undefined ? `<div class="choices"><button class="btn small" data-side="human">Keep yours: <b>${esc(c.human.slice(0, 50) || "(nothing)")}</b></button><button class="btn small" data-side="agent">Keep agent's: <b>${esc(c.agent.slice(0, 50) || "(nothing)")}</b></button></div>` : ""}</div>`);
          if (r) row.onclick = () => jump(r.from, r.to);
          for (const b of row.querySelectorAll<HTMLElement>("[data-side]"))
            b.onclick = (e) => {
              e.stopPropagation();
              session.resolveConflict(m.sha, i, b.dataset.side === "human" ? c.human : c.agent);
            };
          card.append(row);
        });
        m.hunks.forEach((hk, i) => {
          const r = session.resolve(hk);
          const after = r ? text.slice(r.from, r.to) : "";
          const row = h(`<div class="hunk"><div class="diff">${hk.before ? `<del>${esc(hk.before.slice(0, 120))}</del>` : ""}${after ? `<ins>${esc(after.slice(0, 120))}</ins>` : ""}</div>
            ${canWrite ? `<button class="link" data-revert title="Undo this change">Revert</button>` : ""}</div>`);
          if (r) row.onclick = () => jump(r.from, r.to);
          row.querySelector<HTMLElement>("[data-revert]")?.addEventListener("click", (e) => {
            e.stopPropagation();
            session.revertHunk(m.sha, i);
          });
          card.append(row);
        });
        if (canWrite) {
          const done = h(`<button class="btn small wide">${checkIcon} Looks good</button>`);
          done.onclick = () => session.dismiss(m.sha);
          card.append(done);
        }
        return card;
      }),
    );
  }

  async function writeComments(message: string, fn: (l: Comment[]) => Comment[]) {
    try {
      await comments.mutate(message, fn);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
    refresh();
  }

  // The panel is rebuilt on every change; drafts and focus survive in `drafts` / data-draft keys.
  const drafts: Record<string, string> = {};
  const draftInput = (field: HTMLInputElement | HTMLTextAreaElement, key: string) => {
    field.dataset.draft = key;
    field.value = drafts[key] ?? "";
    field.oninput = () => (drafts[key] = field.value);
    field.onkeydown = (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey || field instanceof HTMLInputElement)) {
        e.preventDefault();
        field.form?.requestSubmit();
      }
    };
  };

  function renderComments(threads: Thread[]) {
    const box = $("comments");
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.draft;
    const nodes: HTMLElement[] = [];
    if (composing) {
      const c = composing;
      const form = h(`<form class="card compose"><q>${esc(c.quote.slice(0, 200))}</q>
        <div class="who">${avatar(user.login, 22)}<textarea placeholder="Add a comment…" rows="2"></textarea></div>
        <div class="actions"><button type="button" class="link" data-cancel>Cancel</button><button class="btn primary small">Comment</button></div></form>`);
      draftInput(form.querySelector("textarea")!, "new");
      form.onsubmit = (e) => {
        e.preventDefault();
        const body = (drafts.new ?? "").trim();
        if (!body) return;
        composing = null;
        delete drafts.new;
        const root: Comment = { id: crypto.randomUUID(), author: user.login, body, createdAt: new Date().toISOString(), docId: session.docId, ...c.anchor, quote: c.quote };
        void writeComments(`Comment on ${path}`, (l) => [...l, root]);
      };
      form.querySelector<HTMLElement>("[data-cancel]")!.onclick = () => ((composing = null), refresh());
      nodes.push(form);
    }
    const open = threads.filter((t) => !t.root.resolved);
    const resolved = threads.filter((t) => t.root.resolved);
    if (!open.length && !composing) nodes.push(h(`<p class="empty">Select text and click <b>Comment</b> to start a discussion.</p>`));
    for (const t of open) nodes.push(threadCard(t));
    if (resolved.length) {
      const d = h(`<details class="resolved"><summary>${resolved.length} resolved</summary></details>`);
      for (const t of resolved) d.append(threadCard(t));
      nodes.push(d);
    }
    nodes.push(h(`<p class="fine">Agents read comments with<br><code>git show origin/red-letter-comments:${esc(comments.file)}</code></p>`));
    box.replaceChildren(...nodes);
    const refocus = focused && box.querySelector<HTMLInputElement>(`[data-draft="${focused}"]`);
    if (refocus) {
      refocus.focus();
      refocus.setSelectionRange(refocus.value.length, refocus.value.length);
    }
  }

  function threadCard(t: Thread): HTMLElement {
    const msg = (c: Comment) =>
      `<div class="c"><div class="who">${avatar(c.author, 22)}<b>${esc(c.author)}</b><span class="meta">${ago(c.createdAt)}</span></div><div class="body">${esc(c.body)}</div></div>`;
    const where = t.range ? (t.moved ? `<span class="meta">· text changed since</span>` : "") : `<span class="meta">· text was removed</span>`;
    const card = h(`<div class="card thread${t.root.id === activeThread ? " active" : ""}">
      <div class="quote"><q>${esc((t.root.quote ?? "").slice(0, 120))}</q>${where}</div>
      ${msg(t.root)}${t.replies.map(msg).join("")}
      ${
        canWrite
          ? `<form class="reply"><input placeholder="Reply…"><button type="button" class="link" data-resolve>${t.root.resolved ? "Reopen" : `${checkIcon} Resolve`}</button></form>`
          : ""
      }
    </div>`);
    card.onclick = (e) => {
      if ((e.target as HTMLElement).closest("form")) return;
      activeThread = t.root.id;
      if (t.range) jump(t.range.from, t.range.to);
      refresh();
    };
    const form = card.querySelector("form");
    if (form) {
      draftInput(form.querySelector("input")!, t.root.id);
      form.onsubmit = (e) => {
        e.preventDefault();
        const body = (drafts[t.root.id] ?? "").trim();
        if (!body) return;
        delete drafts[t.root.id];
        const reply: Comment = { id: crypto.randomUUID(), parent: t.root.id, author: user.login, body, createdAt: new Date().toISOString() };
        void writeComments(`Reply on ${path}`, (l) => [...l, reply]);
      };
      form.querySelector<HTMLElement>("[data-resolve]")!.onclick = () =>
        void writeComments(`${t.root.resolved ? "Reopen" : "Resolve"} comment on ${path}`, (l) =>
          l.map((c) => (c.id === t.root.id ? { ...c, resolved: !t.root.resolved } : c)),
        );
    }
    return card;
  }

  // ---- wiring ----
  $("b-panel").onclick = () => {
    panelOpen = $("panel").hidden === true;
    refresh();
  };
  for (const b of el.querySelectorAll<HTMLElement>("[data-tab]"))
    b.onclick = () => {
      tab = b.dataset.tab === "changes" ? "changes" : "comments";
      refresh();
    };
  $("b-share").onclick = async () => {
    await navigator.clipboard.writeText(location.href);
    $("b-share").textContent = "Link copied";
    setTimeout(() => ($("b-share").textContent = "Share"), 1500);
  };
  // clicking a comment highlight opens its thread
  $("editor").addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-thread]")?.dataset.thread;
    if (!id) return;
    activeThread = id;
    tab = "comments";
    panelOpen = true;
    refresh();
  });
  session.onStatus = refresh;
  session.handle.on("change", refresh);
  const tick = () => {
    void session.poll();
    void comments.refresh().then((changed) => changed && refresh(), () => {});
  };
  setInterval(tick, 15_000);
  window.addEventListener("focus", tick);
  window.addEventListener("beforeunload", (e) => {
    if (canWrite && session.status.dirty && session.status.people.length === 0) {
      void session.save();
      e.preventDefault();
    }
  });
  Object.assign(window, { rl: { session, comments, view } }); // debugging + smoke tests
  refresh();
}
