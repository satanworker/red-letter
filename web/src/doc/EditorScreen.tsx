// The workspace: header, file sidebar, the doc, and the comments / agent-changes panel.
// Switching files swaps only the doc: the Editor is keyed on the Session.
import { For, Show, createMemo, createSignal } from "solid-js";
import { CommentsPanel } from "../comments/CommentsPanel.tsx";
import { selectThreads } from "../comments/commentsSelectors.ts";
import { comments } from "../comments/commentsStore.ts";
import { encPath } from "../github.ts";
import { FileSidebar } from "../repo/FileSidebar.tsx";
import { repo, toggleFiles } from "../repo/repoStore.ts";
import { Avatar, BranchIcon, CommentIcon, Logo, RobotIcon, SidebarIcon } from "../ui.tsx";
import { AgentChanges, Banner } from "./AgentChanges.tsx";
import { Editor } from "./Editor.tsx";
import { selectMarks, selectPanelVisible, selectTab } from "./docSelectors.ts";
import { doc, setTab, togglePanel } from "./docStore.ts";

export function EditorScreen() {
  const full = () => repo.repo!.full_name;
  const file = () => repo.path.split("/").pop() ?? "";
  const dir = () => repo.path.split("/").slice(0, -1);
  const canWrite = () => repo.repo?.permissions?.push === true;
  const threads = createMemo(() => {
    doc.version;
    return doc.session ? selectThreads(doc.session, comments.list) : [];
  });
  const marks = createMemo(() => {
    doc.version;
    return doc.session ? selectMarks(doc.session) : [];
  });
  const openCount = () => threads().filter((t) => !t.root.resolved).length;
  const panelVisible = () => !!doc.session && selectPanelVisible(doc, openCount(), marks().length);
  const tab = () => selectTab(doc, openCount(), marks().length);
  const people = () => [...new Set(doc.status.people)];
  const [copied, setCopied] = createSignal(false);
  const share = async () => {
    await navigator.clipboard.writeText(location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div class="editor-screen">
      <header>
        <span class="brand">
          <Show when={repo.filesHidden}>
            <button class="btn ghost icon" title="Show files" onClick={toggleFiles}>
              <SidebarIcon />
            </button>
          </Show>
          <Logo />
        </span>
        <span class="crumbs">
          <a href={`/${full()}/tree/${encPath(repo.branch)}`} class="crumb">
            {full()}
          </a>
          <span class="sep">/</span>
          <Show when={dir().length}>
            <span class="crumb dir" title={dir().join("/")}>
              {dir().length > 2 ? `…/${dir().slice(-2).join("/")}` : dir().join("/")}
            </span>
            <span class="sep">/</span>
          </Show>
          <a href={`https://github.com/${full()}/blob/${encPath(repo.branch)}/${encPath(repo.path)}`} target="_blank" class="crumb file" title="Open on GitHub">
            {file()}
          </a>
          <span class="pill" title="branch">
            <BranchIcon />
            {repo.branch}
          </span>
          <Show when={!canWrite()}>
            <span class="pill">read-only</span>
          </Show>
        </span>
        <Show when={doc.session}>
          <span class="status">
            <Show when={!doc.status.saving} fallback="Saving…">
              <Show when={!doc.status.dirty} fallback="Edited">
                Saved <span class="dot">●</span>{" "}
                <a href={`https://github.com/${full()}/commit/${doc.status.commit}`} target="_blank" title={`Last commit on ${repo.branch}`}>
                  {doc.status.commit.slice(0, 7)}
                </a>
              </Show>
            </Show>
            <Show when={canWrite() && !doc.status.online}>
              {" "}
              ·{" "}
              <span class="warn" title="Live sync is reconnecting; edits are kept and saved to git">
                offline
              </span>
            </Show>
            <Show when={doc.status.error}>
              {(err) => (
                <>
                  {" "}
                  ·{" "}
                  <span class="err" title={err()}>
                    error
                  </span>
                </>
              )}
            </Show>
          </span>
        </Show>
        <span class="spacer" />
        <span class="people" title={people().length ? `Also here: ${people().join(", ")}` : ""}>
          <For each={people()}>{(p) => <Avatar login={p} size={24} />}</For>
        </span>
        <button class="btn ghost icon" title="Comments and changes" onClick={() => togglePanel(panelVisible())}>
          <CommentIcon />
          <span id="count">{openCount() || ""}</span>
        </button>
        <button class="btn share" onClick={() => void share()}>
          {copied() ? "Link copied" : "Share"}
        </button>
        <span class="me">
          <Avatar login={repo.user!.login} size={28} />
        </span>
      </header>
      <main>
        <FileSidebar />
        <div id="doc">
          <Show
            when={doc.session}
            keyed
            fallback={
              <Show
                when={doc.opening}
                fallback={
                  <div class="empty-doc">
                    <p>{repo.message}</p>
                    <p class="fine">Pick a file on the left.</p>
                  </div>
                }
              >
                <div class="loading">
                  <div class="spinner" />
                  Opening {doc.opening.split("/").pop()}…
                </div>
              </Show>
            }
          >
            {(s) => (
              <>
                <Banner marks={marks} />
                <Editor session={s} marks={marks} threads={threads} />
              </>
            )}
          </Show>
        </div>
        <aside id="panel" hidden={!panelVisible()}>
          <div class="tabs">
            <button classList={{ on: tab() === "comments" }} onClick={() => setTab("comments")}>
              <CommentIcon />
              Comments
              <Show when={openCount()}>
                <i class="badge">{openCount()}</i>
              </Show>
            </button>
            <button classList={{ on: tab() === "changes" }} title="Agent changes" aria-label="Agent changes" onClick={() => setTab("changes")}>
              <RobotIcon />
              <Show when={marks().length}>
                <i class="badge">{marks().length}</i>
              </Show>
            </button>
          </div>
          <Show when={doc.session} keyed>
            {(s) => (
              <>
                <div id="changes" hidden={tab() !== "changes"}>
                  <AgentChanges session={s} marks={marks} />
                </div>
                <div id="comments" hidden={tab() !== "comments"}>
                  <CommentsPanel canWrite={s.canWrite} threads={threads} />
                </div>
              </>
            )}
          </Show>
        </aside>
      </main>
    </div>
  );
}
