// The workspace: header, file sidebar, the doc, and the comments / history panel.
// Switching files swaps only the doc: the Editor is keyed on the Session.
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { CommentsPanel } from "../comments/CommentsPanel.tsx";
import { selectThreads } from "../comments/commentsSelectors.ts";
import { comments } from "../comments/commentsStore.ts";
import { encPath } from "../github.ts";
import { FileSidebar } from "../repo/FileSidebar.tsx";
import { blobUrl } from "../repo/repoService.ts";
import { createDraft, mergeDraft, navigateTo, repo, toggleFiles } from "../repo/repoStore.ts";
import { Palette } from "../palette/Palette.tsx";
import { palette } from "../palette/paletteStore.ts";
import { Avatar, BranchIcon, CommentIcon, Logo, SidebarIcon, Spinner, badge, fine, ghostBtn } from "../ui.tsx";
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
    return doc.session ? selectThreads(doc.session, comments.list) : [];
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
  const openCount = () => threads().filter((t) => !t.root.resolved).length;
  const tab = () => selectTab(doc, openCount(), marks().length);
  const people = () => [...new Set(doc.status.people)];
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
          <i class={`${badge} px-[3px]`}>{openCount()}</i>
        </Show>
      </button>
      <button
        role="tab"
        id="tab-history"
        aria-selected={tab() === "history"}
        aria-controls="panel"
        tabindex={tab() === "history" ? 0 : -1}
        title={marks().length ? "History: agent commits to review" : "History"}
        class={tabClass(tab() === "history", "px-3")}
        onClick={() => showTab("history")}
      >
        <BranchIcon />
        <Show when={tab() === "history"}>History</Show>
        <Show when={marks().length}>
          <i class={`${badge} px-[3px]`}>{marks().length}</i>
        </Show>
      </button>
    </div>
  );

  // px values are Figma "Desktop - 1" (1:8) coordinates. Figma strokes don't move content, so frames use outlines.
  return (
    <div class="flex h-screen flex-col">
      <header class="relative z-[3] flex h-[35px] shrink-0 items-start whitespace-nowrap bg-side pr-2 pl-4 shadow-figma outline-[.5px] -outline-offset-[.5px] outline-line">
        {/* columns line up with the 320px sidebar, the flexible doc and the 320px panel (less the header's 8px right padding) */}
        <span class="flex w-[304px] shrink-0 items-center gap-2 pt-[7px]">
          <Show when={repo.filesHidden}>
            <button class={ghostBtn} title="Show files" aria-label="Show files" onClick={toggleFiles}>
              <SidebarIcon />
            </button>
          </Show>
          <Logo />
        </span>
        <nav aria-label="File path" class="mt-[9px] flex min-w-0 flex-1 items-center overflow-hidden pr-3">
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
        </nav>
        <div class="flex w-[312px] shrink-0 items-start">
          <Show when={doc.session}>
            <span class="mt-2.5 flex gap-3" role="status">
              <Show when={!doc.status.saving} fallback="Saving…">
                <Show when={!doc.status.dirty} fallback="Edited">
                  Saved <span class="w-2">●</span>
                  <a class="underline" href={`https://github.com/${full()}/commit/${doc.status.commit}`} target="_blank" title={`Last commit on ${repo.branch}`}>
                    {doc.status.commit.slice(0, 7)}
                  </a>
                </Show>
              </Show>
              <Show when={canWrite() && !doc.status.online}>
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
          <span class="mt-[5.5px] mr-2 inline-flex" title={people().length ? `Also here: ${people().join(", ")}` : ""}>
            <For each={people()}>
              {(p) => (
                <span class="-ml-1.5 rounded-full ring-2 ring-side first:ml-0">
                  <Avatar login={p} size={24} />
                </span>
              )}
            </For>
          </span>
          <button
            class="mt-[5.6px] mr-[9.2px] inline-flex cursor-pointer items-center rounded-lg border-[.4px] border-line px-2 py-1 shadow-figma hover:bg-hover"
            onClick={() => void share()}
          >
            {copied() ? "Link copied" : "Share"}
          </button>
          <span class="mt-1 inline-flex">
            <Avatar login={repo.user!.login} size={28} />
          </span>
        </div>
      </header>
      <main class="relative flex min-h-0 flex-1">
        <FileSidebar />
        <div id="doc" class="group/doc min-w-0 flex-1 overflow-auto bg-bg">
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
                <Show when={canWrite()}>
                  <IconPicker icon={icon()} />
                </Show>
                <Editor session={s} marks={marks} changes={changes} threads={threads} />
              </>
            )}
          </Show>
        </div>
        <aside id="panel" aria-label="Comments and history" hidden={!doc.session} class="w-80 shrink-0 overflow-auto bg-side p-4 outline-[.5px] -outline-offset-[.5px] outline-line">
          <div class="mb-4">{tabs()}</div>
          <Show when={doc.session} keyed>
            {(s) => (
              <>
                <div id="history" role="tabpanel" aria-labelledby="tab-history" hidden={tab() !== "history"}>
                  <History session={s} entries={history} />
                </div>
                <div id="comments" role="tabpanel" aria-labelledby="tab-comments" class="flex flex-col gap-4" hidden={tab() !== "comments"}>
                  <CommentsPanel canWrite={s.canWrite} threads={threads} />
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
