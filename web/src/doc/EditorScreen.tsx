// The workspace: header, file sidebar, the doc, and the comments / history panel.
// Switching files swaps only the doc: the Editor is keyed on the Session.
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { CommentsPanel } from "../comments/CommentsPanel.tsx";
import { selectThreads } from "../comments/commentsSelectors.ts";
import { comments } from "../comments/commentsStore.ts";
import { encPath } from "../github.ts";
import { FileSidebar } from "../repo/FileSidebar.tsx";
import { blobUrl } from "../repo/repoService.ts";
import { createDraft, mergeDraft, navigateTo, repo, toggleFiles, togglePanel } from "../repo/repoStore.ts";
import { Palette } from "../palette/Palette.tsx";
import { palette } from "../palette/paletteStore.ts";
import { Avatar, BranchIcon, CommentIcon, EditIcon, Logo, SidebarIcon, Spinner, badge, count, fine, ghostBtn } from "../ui.tsx";
import { Editor } from "./Editor.tsx";
import { History } from "./History.tsx";
import { IconPicker } from "./IconPicker.tsx";
import { selectDraftChanges, selectHistory, selectIcon, selectMarks, selectTab } from "./docSelectors.ts";
import { doc, showFavicon, showTab, toggleChanges, updateDraft } from "./docStore.ts";

export function EditorScreen() {
  const full = () => repo.repo!.full_name;
  const file = () => repo.path.split("/").pop() ?? "";
  const dir = () => repo.path.split("/").slice(0, -1);
  const canWrite = () => repo.repo?.permissions?.push === true;
  const threads = createMemo(() => {
    doc.version;
    return doc.session ? selectThreads(doc.session.doc.text, comments.text) : [];
  });
  const marks = createMemo(() => {
    doc.version;
    return doc.session ? selectMarks(doc.session) : [];
  });
  const history = createMemo(() => selectHistory(doc.history, marks()));
  const draft = createMemo(() => {
    doc.version;
    return doc.session?.doc.base;
  });
  const changes = createMemo(() => {
    doc.version;
    return doc.showChanges && doc.session ? selectDraftChanges(doc.session) : [];
  });
  const icon = createMemo(() => {
    doc.version;
    return doc.session ? (selectIcon(doc.session.doc.text)?.icon ?? "") : "";
  });
  createEffect(() => showFavicon(icon()));
  onCleanup(() => showFavicon(""));
  // the branch this file came from, this branch and every draft: one picker, like Patchwork's
  const branches = () => [...new Set([draft()?.branch ?? repo.branch, repo.branch, ...repo.drafts])];
  const pickBranch = (sel: HTMLSelectElement) => {
    const branch = sel.value;
    sel.value = repo.branch; // the route decides which branch shows
    if (branch) return navigateTo(blobUrl(full(), branch, repo.path));
    const name = prompt("Name the draft", `${file().replace(/\.[^.]+$/, "")}-edits`);
    if (name) void createDraft(name);
  };
  const openCount = () => threads().filter((t) => !t.resolved).length;
  const tab = () => selectTab(doc, openCount(), marks().length);
  // other people on this file; your own other tabs count for saving (Session.close) but aren't shown
  const people = () => [...new Set(doc.status.people)].filter((p) => p !== repo.user?.login);
  const size = createMemo(() => {
    doc.version; // the CRDT doc changed: local typing, peers, agents
    const text = doc.session?.doc.text ?? "";
    return { words: text.match(/\S+/g)?.length ?? 0, chars: text.length };
  });
  const [copied, setCopied] = createSignal(false);
  const share = async () => {
    await navigator.clipboard.writeText(location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  // Arrow keys move between the two tabs (WAI-ARIA tabs pattern); Tab goes into the panel.
  const tabKeys = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    showTab(tab() === "comments" ? "history" : "comments");
    (e.currentTarget as HTMLElement).querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  };
  // Figma 22:561: the chosen tab is white with its label; the other one shrinks to a grey icon + count pill.
  const tabClass = (on: boolean, pad: string) =>
    `inline-flex h-7 cursor-pointer items-center gap-1 rounded-[14px] text-fg shadow-figma ${on ? "bg-card px-4" : `border-[.4px] border-line bg-side ${pad}`}`;
  const tabs = () => (
    <div role="tablist" aria-label="Side panel" class="flex gap-2" onKeyDown={tabKeys}>
      <button
        role="tab"
        id="tab-comments"
        aria-selected={tab() === "comments"}
        aria-controls="panel"
        tabindex={tab() === "comments" ? 0 : -1}
        title="Comments"
        class={tabClass(tab() === "comments", "px-4")}
        onClick={() => showTab("comments")}
      >
        <CommentIcon />
        <Show when={tab() === "comments"}>Comments</Show>
        <Show when={openCount()}>
          <i class={count}>{openCount()}</i>
        </Show>
      </button>
      <button
        role="tab"
        id="tab-history"
        aria-selected={tab() === "history"}
        aria-controls="panel"
        tabindex={tab() === "history" ? 0 : -1}
        title={marks().length ? "History: agent edits that collided with yours, to settle" : "History"}
        class={tabClass(tab() === "history", "px-3")}
        onClick={() => showTab("history")}
      >
        <BranchIcon />
        <Show when={tab() === "history"}>History</Show>
        <Show when={marks().length}>
          <i class={count}>{marks().length}</i>
        </Show>
      </button>
    </div>
  );

  // px values are Figma "RED LETTER 5 NOV" (129:1304) coordinates. Figma strokes don't move content, so frames use outlines.
  return (
    <div class="flex h-screen flex-col">
      <header class="relative z-[3] flex h-[35px] shrink-0 items-start whitespace-nowrap bg-side shadow-figma outline-[.5px] -outline-offset-[.5px] outline-line">
        {/* Figma 129:1583: its own box over the 320px sidebar, the files toggle at its right edge; then the doc and the 320px panel */}
        <span class="relative w-80 shrink-0 self-stretch border-r-[.5px] border-line pt-[7px] pl-3">
          <Logo />
          <button
            class="absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer rounded hover:bg-hover"
            title={repo.filesHidden ? "Show files" : "Hide files"}
            aria-label={repo.filesHidden ? "Show files" : "Hide files"}
            onClick={toggleFiles}
          >
            <SidebarIcon closed={repo.filesHidden} />
          </button>
        </span>
        <nav aria-label="File path" class="mt-[9px] flex min-w-0 flex-1 items-center overflow-hidden px-3 text-muted">
          <a href={`/${full()}/tree/${encPath(repo.branch)}`} class="truncate hover:underline">
            {full()}
          </a>
          <span>/</span>
          <Show when={dir().length}>
            <span class="truncate" title={dir().join("/")}>
              {dir().length > 2 ? `…/${dir().slice(-2).join("/")}` : dir().join("/")}
            </span>
            <span>/</span>
          </Show>
          <a href={`https://github.com/${full()}/blob/${encPath(repo.branch)}/${encPath(repo.path)}`} target="_blank" class="truncate hover:underline" title="Open on GitHub">
            {file()}
          </a>
          <label class={`ml-2 inline-flex items-center gap-1 ${badge} px-1.5`} title="Branch: switch, or start a draft of this file">
            <BranchIcon />
            <select class="max-w-[260px] cursor-pointer truncate bg-transparent" onChange={(e) => pickBranch(e.currentTarget)}>
              <For each={branches()}>
                {(b) => (
                  <option value={b} selected={b === repo.branch}>
                    {b}
                  </option>
                )}
              </For>
              <Show when={canWrite() && doc.session && !draft()}>
                <option value="">+ New draft…</option>
              </Show>
            </select>
          </label>
          <Show when={!canWrite()}>
            <span class={`ml-2 ${badge} px-1.5`}>read-only</span>
          </Show>
          <Show when={comments.viaPr}>
            <span class={`ml-2 ${badge} px-1.5`} title={`${repo.branch} is protected: no edits here; comments go through a pull request`}>
              protected
            </span>
          </Show>
        </nav>
        <div class="flex w-80 shrink-0 items-start px-3">
          <Show when={doc.session}>
            {/* Figma 140:2607 / 140:2799: the comments panel's toggle, 12px before the status */}
            <button
              class="mt-[10px] mr-3 cursor-pointer rounded hover:bg-hover"
              title={repo.panelHidden ? "Show comments" : "Hide comments"}
              aria-label={repo.panelHidden ? "Show comments" : "Hide comments"}
              aria-controls="panel"
              aria-expanded={!repo.panelHidden}
              onClick={togglePanel}
            >
              <SidebarIcon closed={repo.panelHidden} right />
            </button>
            <span class="mt-2.5 flex gap-3" role="status">
              <Show when={!doc.status.saving} fallback="Saving…">
                <Show when={!doc.status.dirty} fallback="Edited">
                  Saved <span class="w-2">●</span>
                  <a class="underline" href={`https://github.com/${full()}/commit/${doc.status.commit}`} target="_blank" title={`Last commit on ${repo.branch}`}>
                    {doc.status.commit.slice(0, 7)}
                  </a>
                </Show>
              </Show>
              <Show when={doc.session?.canWrite && !doc.status.online}>
                <span class="text-[#d9730d]" title="Live sync is reconnecting; edits are kept and saved to git">
                  offline
                </span>
              </Show>
              <Show when={doc.status.error}>
                {(err) => (
                  <span class="text-red" title={err()}>
                    error
                  </span>
                )}
              </Show>
            </span>
          </Show>
          <span class="flex-1" />
          <span class="mt-[5.5px] mr-3 inline-flex" title={people().length ? `Also here: ${people().join(", ")}` : ""}>
            <For each={people()}>
              {(p) => (
                <span class="-ml-1.5 rounded-full ring-2 ring-side first:ml-0">
                  <Avatar login={p} size={24} />
                </span>
              )}
            </For>
          </span>
          <button class="mt-2.5 cursor-pointer hover:underline" onClick={() => void share()}>
            {copied() ? "Link copied" : "Share"}
          </button>
        </div>
      </header>
      <main class="relative flex min-h-0 flex-1">
        <FileSidebar />
        {/* over the header's shadow: in Figma the tab strip sits there, so the shadow never lands on the white page */}
        <div id="doc" class="group/doc relative z-[4] min-w-0 flex-1 overflow-auto bg-bg">
          <Show
            when={doc.session}
            keyed
            fallback={
              <Show
                when={doc.opening}
                fallback={
                  <div class="mx-auto my-[20vh] max-w-[440px] px-6 text-[14px] text-muted">
                    <p>{repo.message}</p>
                    <p class={fine}>Pick a file on the left.</p>
                  </div>
                }
              >
                <div class="flex h-[60vh] items-center justify-center gap-2.5 text-muted">
                  <Spinner />
                  Opening {doc.opening.split("/").pop()}…
                </div>
              </Show>
            }
          >
            {(s) => (
              <>
                <Show when={draft() || doc.draftNote}>
                  {/* floats in the doc's top padding instead of pushing the text down */}
                  <div class="sticky top-0 z-[5] h-0">
                    <Show when={draft()}>
                      {(b) => (
                        <div class="mx-auto mt-2 flex max-w-[440px] items-center gap-1 rounded-xl bg-card py-1 pr-1.5 pl-3 whitespace-nowrap shadow-figma">
                          <span class="flex-1 truncate text-muted">draft of {b().branch}</span>
                          <button
                            class={doc.showChanges ? "inline-flex h-6 cursor-pointer items-center rounded bg-on px-1 text-fg" : `${ghostBtn} h-6`}
                            aria-pressed={doc.showChanges}
                            title={`Highlight what this draft changed from ${b().branch}`}
                            onClick={toggleChanges}
                          >
                            Changes
                          </button>
                          <Show when={doc.status.baseHead && doc.status.baseHead !== b().commit}>
                            <button
                              class={`${ghostBtn} h-6 disabled:cursor-default disabled:opacity-50`}
                              disabled={!!doc.drafting}
                              title={`${b().branch} has new edits: merge them into this draft`}
                              onClick={() => void updateDraft()}
                            >
                              Update from {b().branch}
                            </button>
                          </Show>
                          <button
                            class={`${ghostBtn} h-6 disabled:cursor-default disabled:opacity-50`}
                            disabled={!!doc.drafting || !canWrite()}
                            title={`Merge this draft into ${b().branch} and delete it`}
                            onClick={() => void mergeDraft()}
                          >
                            {doc.drafting || `Merge into ${b().branch}`}
                          </button>
                        </div>
                      )}
                    </Show>
                    <Show when={doc.draftNote}>
                      <p class="mx-auto mt-1.5 max-w-[440px] rounded-xl bg-yellow-bg px-3 py-1.5">{doc.draftNote}</p>
                    </Show>
                  </div>
                </Show>
                <Show when={s.canWrite}>
                  <IconPicker icon={icon()} />
                </Show>
                <Editor session={s} marks={marks} changes={changes} threads={threads} />
                {/* Figma 137:2487: pinned to the doc's bottom-right corner while it scrolls */}
                <div class="sticky bottom-0 z-[5] h-0">
                  <p class="absolute right-0 bottom-0 flex h-6 items-center gap-2.5 rounded-tl-xl border-t-[.4px] border-l-[.4px] border-rule bg-card px-3 font-light whitespace-nowrap text-muted">
                    <EditIcon />
                    <span>{size().words} words</span>
                    <span>{size().chars} characters</span>
                  </p>
                </div>
              </>
            )}
          </Show>
        </div>
        {/* no top edge: the header's bottom line is this frame's top too (Figma's centred strokes overlap) */}
        <aside id="panel" aria-label="Comments and history" hidden={!doc.session || repo.panelHidden} class="w-80 shrink-0 overflow-auto border-[.5px] border-t-0 border-line bg-side px-3 py-4">
          <div class="mb-4">{tabs()}</div>
          <Show when={doc.session} keyed>
            {(s) => (
              <>
                <div id="history" role="tabpanel" aria-labelledby="tab-history" hidden={tab() !== "history"}>
                  <History session={s} entries={history} />
                </div>
                <div id="comments" role="tabpanel" aria-labelledby="tab-comments" class="flex flex-col gap-4" hidden={tab() !== "comments"}>
                  <CommentsPanel canComment={s.canWrite || comments.viaPr} threads={threads} />
                </div>
              </>
            )}
          </Show>
        </aside>
      </main>
      <Show when={palette.open}>
        <Palette />
      </Show>
    </div>
  );
}
