// Routes, editor, side panel. Plain DOM; CodeMirror 6 bound to the Automerge text.
import { automergeSyncPlugin, type DocHandle as PluginHandle } from "@automerge/automerge-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState, StateEffect, StateField, Transaction, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { marked } from "marked";
import { Comments, type Comment } from "./comments.ts";
import { Session, type Anchor, type RLDoc } from "./doc.ts";
import {
  APP_SLUG,
  HttpError,
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

export function start() {
  route().catch((e) => fatal(e instanceof Error ? e.message : String(e)));
}

function fatal(msg: string) {
  app.replaceChildren(h(`<div class="screen"><h1>Something went wrong</h1><p class="err">${esc(msg)}</p><p><a href="/">Home</a></p></div>`));
}

async function route(): Promise<void> {
  if (location.pathname === "/auth/callback") {
    history.replaceState(null, "", await completeSignIn());
    return route();
  }
  const m = location.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  if (!m) return landing();
  if (!(await token())) return signInScreen();
  return openFile(m[1], m[2], m[3].split("/").map(decodeURIComponent));
}

// ---------------------------------------------------------------- screens
async function landing() {
  const user = await currentUser().catch(() => null);
  const el = h(`<div class="screen">
    <h1><span class="red">Red</span> Letter</h1>
    <p>Edit the markdown files in your GitHub repo together, live, and leave comments in the margin.
    Git stays the source of truth: agents keep using <code>git pull</code> / <code>git push</code>, and their commits show up here as reviewable changes.</p>
    <form><input name="u" placeholder="https://github.com/owner/repo/blob/main/README.md" autofocus><button>Open</button></form>
    <p class="muted">Tip: replace <code>github.com</code> with <code>${esc(location.host)}</code> in any file URL.</p>
    <p>${user ? `Signed in as <b>${esc(user.login)}</b> · <a href="#" id="out">sign out</a>` : `<button id="in">Sign in with GitHub</button>`}</p>
  </div>`);
  el.querySelector("form")!.onsubmit = (e) => {
    e.preventDefault();
    const u = (el.querySelector("input") as HTMLInputElement).value.trim();
    const path = u.replace(/^https?:\/\/(www\.)?github\.com/, "").replace(/^https?:\/\/[^/]+/, "");
    location.assign(path.startsWith("/") ? path : `/${path}`);
  };
  el.querySelector<HTMLElement>("#in")?.addEventListener("click", () => void signIn());
  el.querySelector<HTMLElement>("#out")?.addEventListener("click", (e) => {
    e.preventDefault();
    signOut();
    void landing();
  });
  app.replaceChildren(el);
}

function signInScreen() {
  const el = h(`<div class="screen"><h1><span class="red">Red</span> Letter</h1>
    <p>Sign in with GitHub to open <code>${esc(location.pathname.slice(1))}</code>.</p>
    <p><button>Sign in with GitHub</button></p></div>`);
  el.querySelector("button")!.onclick = () => void signIn();
  app.replaceChildren(el);
}

function installScreen(owner: string, repo: string) {
  const el = h(`<div class="screen"><h1>Red Letter isn't set up for ${esc(owner)}/${esc(repo)}</h1>
    <p>The Red Letter app needs to be installed on this repository before you can edit it here (or your GitHub account has no access to it).</p>
    <p><button>Install Red Letter on ${esc(owner)}</button></p>
    <p class="muted">If you don't own the repo, ask its owner to install <a href="https://github.com/apps/${APP_SLUG}">the app</a>.</p></div>`);
  el.querySelector("button")!.onclick = () => {
    rememberReturn();
    location.assign(`https://github.com/apps/${APP_SLUG}/installations/new`);
  };
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
  app.replaceChildren(h(`<div class="screen muted">Opening ${esc(rest.join("/"))}…</div>`));
  const repoName = `${owner}/${repo}`;
  const info = await ghJson<{ node_id: string; full_name: string; permissions?: { push: boolean } }>(`/repos/${repoName}`).catch((e) => {
    if (e instanceof HttpError && (e.status === 404 || e.status === 403)) return null;
    throw e;
  });
  if (!info) return installScreen(owner, repo);
  // A user token can only write where the App is installed; public repos read fine without it, so check.
  if (info.permissions?.push && !(await appInstalledOn(info.full_name))) return installScreen(owner, repo);
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

type Thread = { root: Comment; replies: Comment[]; range: { from: number; to: number } | null; moved: boolean };

function editorScreen(session: Session, comments: Comments, user: User) {
  const { repoName, branch, path, canWrite } = session;
  const el = h(`<div class="editor-screen">
    <header>
      <a href="/" class="logo"><span class="red">Red</span> Letter</a>
      <span class="crumbs"><a href="https://github.com/${esc(repoName)}" target="_blank">${esc(repoName)}</a> · <b>${esc(branch)}</b> · ${esc(path)}</span>
      <span id="status" class="muted"></span>
      <span class="spacer"></span>
      <button id="b-preview">Preview</button>
      <button id="b-comment" disabled>Comment</button>
      ${canWrite ? `<button id="b-save">Save</button>` : `<span class="badge">read-only</span>`}
      <img class="avatar" src="${esc(user.avatar_url)}" title="${esc(user.login)}">
    </header>
    <main>
      <div id="editor"></div>
      <iframe id="preview" sandbox="allow-popups allow-popups-to-escape-sandbox" hidden></iframe>
      <aside><div id="changes"></div><div id="comments"></div></aside>
    </main>
  </div>`);
  app.replaceChildren(el);
  const $ = (id: string) => el.querySelector<HTMLElement>(`#${id}`)!;

  // automerge-repo's handle.doc() may be undefined before ready; it is ready here
  const handle = session.handle as unknown as PluginHandle<RLDoc>;
  const view = new EditorView({
    doc: session.doc.text,
    extensions: [
      basicSetup,
      markdown(),
      EditorView.lineWrapping,
      decoField,
      remoteNotUndoable,
      EditorState.readOnly.of(!canWrite),
      keymap.of([{ key: "Mod-s", preventDefault: true, run: () => (void session.save(), true) }]),
      EditorView.updateListener.of((u) => {
        if (u.selectionSet) ($("b-comment") as HTMLButtonElement).disabled = !canWrite || u.state.selection.main.empty;
      }),
      automergeSyncPlugin({ handle, path: ["text"] }),
    ],
    parent: $("editor"),
  });

  let composing: { anchor: Anchor; quote: string } | null = null;
  let activeThread = "";

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
      renderChanges();
      renderComments(threads);
      if (!$("preview").hidden) renderPreview();
    });
  };

  function renderStatus() {
    const s = session.status;
    const parts = [
      s.saving ? "saving…" : s.dirty ? "unsaved changes" : `saved <a href="https://github.com/${esc(repoName)}/commit/${s.commit}" target="_blank">${s.commit.slice(0, 7)}</a>`,
      canWrite ? (s.online ? (s.peers ? `${s.peers} other${s.peers > 1 ? "s" : ""} here` : "live") : "offline") : "",
    ].filter(Boolean);
    $("status").innerHTML = parts.join(" · ") + (s.error ? ` · <span class="err">${esc(s.error)}</span>` : "");
  }

  function buildThreads(): Thread[] {
    const text = session.doc.text;
    const roots = comments.list.filter((c) => !c.parent);
    return roots
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
    const mark = (from: number, to: number, cls: string) => {
      from = Math.min(from, len);
      to = Math.min(to, len);
      if (to > from) out.push(Decoration.mark({ class: cls }).range(from, to));
    };
    for (const m of Object.values(session.doc.marks ?? {})) {
      for (const hk of m.hunks) {
        const r = session.resolve(hk);
        if (!r) continue;
        if (hk.before) out.push(Decoration.widget({ widget: new DelWidget(hk.before), side: -1 }).range(Math.min(r.from, len)));
        mark(r.from, r.to, "rl-agent");
      }
      for (const c of m.conflicts) {
        const r = session.resolve(c);
        if (r) mark(r.from, r.to, "rl-conflict");
      }
    }
    for (const t of threads) if (t.range && !t.root.resolved) mark(t.range.from, t.range.to, t.root.id === activeThread ? "rl-comment active" : "rl-comment");
    view.dispatch({ effects: setDecos.of(Decoration.set(out, true)) });
  }

  function jump(from: number, to: number) {
    view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    view.focus();
  }

  function renderChanges() {
    const marks = Object.values(session.doc.marks ?? {}).sort((a, b) => a.at.localeCompare(b.at));
    const box = $("changes");
    if (!marks.length) return box.replaceChildren();
    const text = session.doc.text;
    box.replaceChildren(
      h(`<h3>Agent changes</h3>`),
      ...marks.map((m) => {
        const card = h(`<div class="card">
          <div class="meta"><b>${esc(m.author)}</b> pushed <a href="https://github.com/${esc(repoName)}/commit/${m.sha}" target="_blank">${m.sha.slice(0, 7)}</a>
            ${canWrite ? `<button class="link" data-dismiss>mark reviewed</button>` : ""}</div>
          <div class="msg">${esc(m.message)}</div></div>`);
        card.querySelector<HTMLElement>("[data-dismiss]")?.addEventListener("click", () => session.dismiss(m.sha));
        m.conflicts.forEach((c, i) => {
          const r = session.resolve(c);
          const row = h(`<div class="hunk conflict" title="Jump to text">⚠ You and the agent both edited: <q>${esc(r ? text.slice(r.from, r.to).slice(0, 80) : "")}</q>
            ${canWrite && c.human !== undefined ? `<div>keep <button class="link" data-side="human">yours: <b>${esc(c.human.slice(0, 60) || "(nothing)")}</b></button>
            or <button class="link" data-side="agent">the agent's: <b>${esc(c.agent.slice(0, 60) || "(nothing)")}</b></button></div>` : ""}</div>`);
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
          const row = h(`<div class="hunk" title="Jump to text">${hk.before ? `<del>${esc(hk.before.slice(0, 80))}</del> ` : ""}${after ? `<ins>${esc(after.slice(0, 80))}</ins>` : ""}
            ${canWrite ? `<button class="link" data-revert>revert</button>` : ""}</div>`);
          if (r) row.onclick = () => jump(r.from, r.to);
          row.querySelector<HTMLElement>("[data-revert]")?.addEventListener("click", (e) => {
            e.stopPropagation();
            session.revertHunk(m.sha, i);
          });
          card.append(row);
        });
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
  };

  function renderComments(threads: Thread[]) {
    const box = $("comments");
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.draft;
    const nodes: HTMLElement[] = [h(`<h3>Comments</h3>`)];
    if (composing) {
      const c = composing;
      const form = h(`<form class="card compose"><q>${esc(c.quote.slice(0, 200))}</q><textarea placeholder="Comment" required></textarea>
        <div><button>Comment</button> <button type="button" class="link" data-cancel>cancel</button></div></form>`);
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
    if (!open.length && !composing) nodes.push(h(`<p class="muted">Select text and press Comment.</p>`));
    for (const t of open) nodes.push(threadCard(t));
    if (resolved.length) {
      const d = h(`<details><summary>${resolved.length} resolved</summary></details>`);
      for (const t of resolved) d.append(threadCard(t));
      nodes.push(d);
    }
    nodes.push(h(`<p class="muted small">Agents read these with <code>git show origin/red-letter-comments:${esc(comments.file)}</code></p>`));
    box.replaceChildren(...nodes);
    const refocus = focused && box.querySelector<HTMLInputElement>(`[data-draft="${focused}"]`);
    if (refocus) {
      refocus.focus();
      refocus.setSelectionRange(refocus.value.length, refocus.value.length);
    }
  }

  function threadCard(t: Thread): HTMLElement {
    const msg = (c: Comment) => `<div class="c"><b>${esc(c.author)}</b> <span class="muted small">${new Date(c.createdAt).toLocaleString()}</span><div>${esc(c.body)}</div></div>`;
    const where = t.range ? (t.moved ? `<span class="muted small">text changed since</span>` : "") : `<span class="muted small">detached: text is gone</span>`;
    const card = h(`<div class="card thread${t.root.id === activeThread ? " active" : ""}">
      <q>${esc((t.root.quote ?? "").slice(0, 120))}</q> ${where}
      ${msg(t.root)}${t.replies.map(msg).join("")}
      ${canWrite ? `<form class="reply"><input placeholder="Reply"><button class="link">reply</button><button type="button" class="link" data-resolve>${t.root.resolved ? "reopen" : "resolve"}</button></form>` : ""}
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

  function renderPreview() {
    const html = marked.parse(session.doc.text, { async: false });
    ($("preview") as HTMLIFrameElement).srcdoc =
      `<!doctype html><base target="_blank"><style>body{font:15px/1.6 system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#1f2328}pre,code{background:#f6f8fa;border-radius:4px}pre{padding:12px;overflow:auto}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #d0d7de;padding:4px 8px}</style>${html}`;
  }

  // ---- wiring ----
  $("b-preview").onclick = () => {
    $("preview").hidden = !$("preview").hidden;
    $("b-preview").classList.toggle("on", !$("preview").hidden);
    refresh();
  };
  $("b-comment").onclick = () => {
    const sel = view.state.selection.main;
    if (sel.empty) return;
    composing = { anchor: session.anchor(sel.from, sel.to), quote: view.state.sliceDoc(sel.from, sel.to) };
    refresh();
    // the panel renders on the next frame
    requestAnimationFrame(() => requestAnimationFrame(() => el.querySelector<HTMLElement>('[data-draft="new"]')?.focus()));
  };
  el.querySelector<HTMLElement>("#b-save")?.addEventListener("click", () => void session.save());
  session.onStatus = refresh;
  session.handle.on("change", refresh);
  const tick = () => {
    void session.poll();
    void comments.refresh().then((changed) => changed && refresh(), () => {});
  };
  setInterval(tick, 15_000);
  window.addEventListener("focus", tick);
  window.addEventListener("beforeunload", (e) => {
    if (canWrite && session.status.dirty && session.status.peers === 0) {
      void session.save();
      e.preventDefault();
    }
  });
  Object.assign(window, { rl: { session, comments, view } }); // debugging + smoke tests
  refresh();
}
