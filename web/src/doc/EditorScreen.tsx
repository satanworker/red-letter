// The workspace: header, file sidebar, the doc, and the comments / history / outline panel.
// Switching files swaps only the doc: the Editor is keyed on the Session.
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { CommentsPanel } from "../comments/CommentsPanel.tsx";
import { selectThreads } from "../comments/commentsSelectors.ts";
import { comments, commentsShown, targetPr } from "../comments/commentsStore.ts";
import { FileSidebar } from "../repo/FileSidebar.tsx";
import { activeTab, closeTab, repo, sameTab, tabUrl, toggleFiles, togglePanel, type Tab } from "../repo/repoStore.ts";
import { Palette } from "../palette/Palette.tsx";
import { openInNewTab, palette } from "../palette/paletteStore.ts";
import { keyLabel } from "../palette/commands.ts";
import { Avatar, BranchIcon, CloseIcon, CommentIcon, EditIcon, Logo, OutlineIcon, PlusIcon, SidebarIcon, Spinner, badge, count, fine, listKeys } from "../ui.tsx";
import { PrOverview } from "../pulls/PrOverview.tsx";
import { pulls } from "../pulls/pullsStore.ts";
import { prTitle } from "../repo/pulls.ts";
import { rate, resetTime } from "../rate.ts";
import { Editor } from "./Editor.tsx";
import { PageMenu } from "./PageMenu.tsx";
import { History } from "./History.tsx";
import { IconPicker } from "./IconPicker.tsx";
import { Outline } from "./Outline.tsx";
import { selectDraftChanges, selectHistory, selectIcon, selectMarks, selectTab, selectTextChanges, selectWords } from "./docSelectors.ts";
import { commentThreads } from "./commentMarks.ts";
import { doc, editorState, focusEditor, isReading, showFavicon, showTab, toggleReading } from "./docStore.ts";

export function EditorScreen() {
  const full = () => repo.repo!.full_name;
  const threads = createMemo(() => {
    doc.version;
    const state = editorState();
    const shown = commentsShown(); // the toggle: the PR's threads or the file's
    return doc.session && state ? selectThreads(commentThreads(state), doc.session.doc.text, comments.text, comments.prThreads).filter((t) => !shown || t.source === shown) : [];
  });
  // the same array while no mark or count of conflicts changed: History's rows (and focus in them) survive typing
  const marks = createMemo(
    () => {
      doc.version;
      return doc.session ? selectMarks(doc.session) : [];
    },
    [],
    { equals: (a, b) => a.length === b.length && a.every((m, i) => m.sha === b[i]!.sha && m.conflicts.length === b[i]!.conflicts.length) },
  );
  const history = createMemo(() => selectHistory(doc.history, marks()));
  const changes = createMemo(() => {
    doc.version;
    const s = doc.session;
    if (!doc.showChanges || !s) return [];
    if (s.doc.base) return selectDraftChanges(s);
    return doc.reviewBase !== null ? selectTextChanges(doc.reviewBase, s.doc.text) : [];
  });
  // the open tab is a pull request's description: the doc stays mounted under it, hidden, with its chrome
  const pr = createMemo(() => (repo.pull ? pulls.list.find((p) => p.number === repo.pull) : undefined));
  const onDoc = () => !!doc.session && !repo.pull;
  createEffect(() => {
    if (repo.pull) document.title = `#${repo.pull} ${pr() ? prTitle(pr()!) : ""} · Red Letter`;
    else if (repo.path) document.title = `${repo.path.split("/").pop()} · Red Letter`;
  });
  const icon = createMemo(() => {
    doc.version;
    const text = editorState()?.doc;
    return text ? (selectIcon(text)?.icon ?? "") : "";
  });
  createEffect(() => showFavicon(icon()));
  onCleanup(() => showFavicon(""));
  const openCount = () => threads().filter((t) => !t.resolved).length;
  const tab = () => selectTab(doc, openCount(), marks().length);
  // other people on this file; your own other tabs count for saving (Session.close) but aren't shown
  const people = () => [...new Set(doc.status.people)].filter((p) => p !== repo.user?.login);
  const size = createMemo(() => {
    doc.version; // the CRDT doc changed: local typing, peers, agents
    const text = editorState()?.doc;
    return { words: text ? selectWords(text) : 0, chars: text?.length ?? 0 };
  });
  const [copied, setCopied] = createSignal(false);
  const share = async () => {
    await navigator.clipboard.writeText(location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  // Arrow keys move between the tabs (WAI-ARIA tabs pattern); Tab goes into the panel.
  const tabKeys = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const order = ["outline", "comments", "history"] as const;
    showTab(order[(order.indexOf(tab()) + (e.key === "ArrowRight" ? 1 : 2)) % 3]!);
    (e.currentTarget as HTMLElement).querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  };
  // Figma 22:561: the chosen tab is white with its label; the others shrink to a grey icon + count pill.
  const tabClass = (on: boolean, pad: string) =>
    `inline-flex h-7 cursor-pointer items-center gap-1 rounded-[14px] text-fg shadow-figma ${on ? "bg-card px-4" : `border-[.4px] border-line bg-side ${pad}`}`;
  const tabs = () => (
    <div role="tablist" aria-label="Side panel" class="flex gap-2" onKeyDown={tabKeys}>
      <button
        role="tab"
        id="tab-outline"
        aria-selected={tab() === "outline"}
        aria-controls="panel"
        tabindex={tab() === "outline" ? 0 : -1}
        title="Outline"
        class={tabClass(tab() === "outline", "px-3")}
        onClick={() => showTab("outline")}
      >
        <OutlineIcon />
        <Show when={tab() === "outline"}>Outline</Show>
      </button>
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
            title={`${repo.filesHidden ? "Show files" : "Hide files"} (${keyLabel("Mod-\\")})`}
            aria-label={repo.filesHidden ? "Show files" : "Hide files"}
            onClick={toggleFiles}
          >
            <SidebarIcon closed={repo.filesHidden} />
          </button>
        </span>
        {/* the branch moved to the file sidebar's foot (VS Code's status bar), the pull requests to its tab */}
        <span class="min-w-0 flex-1" />
        {/* at least the panel's 320px; a long status (offline, error, the rate limit) widens it leftwards instead of pushing "…" off-screen */}
        <div class="flex min-w-80 shrink-0 items-start px-3">
          <Show when={onDoc()}>
            {/* Figma 140:2607 / 140:2799: the comments panel's toggle, 12px before the status */}
            <button
              class="mt-[10px] mr-3 cursor-pointer rounded hover:bg-hover"
              title={`${repo.panelHidden ? "Show comments" : "Hide comments"} (${keyLabel("Mod-Shift-\\")})`}
              aria-label={repo.panelHidden ? "Show comments" : "Hide comments"}
              aria-controls="panel"
              aria-expanded={!repo.panelHidden}
              onClick={togglePanel}
            >
              <SidebarIcon closed={repo.panelHidden} right />
            </button>
            <span class="mt-2.5 flex items-center gap-1.5" role="status">
              <Show when={!doc.status.saving} fallback="Saving…">
                <Show when={!doc.status.dirty} fallback="Edited">
                  Saved ·
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
                  <button class="cursor-pointer text-red" title={err()} onClick={() => alert(err())}>
                    error
                  </button>
                )}
              </Show>
              <Show when={rate.blockedUntil > Date.now()}>
                <span class={`${badge} px-1.5 text-red`} title="GitHub's hourly API limit for your account is used up. Nothing is polled until it resets; saves and comments still go through if GitHub lets them.">
                  GitHub limit · resets {resetTime()}
                </span>
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
          <Show when={onDoc() && doc.session}>{(s) => <PageMenu canWrite={s().canWrite} />}</Show>
        </div>
      </header>
      <main class="relative flex min-h-0 flex-1">
        <FileSidebar />
        {/* over the header's shadow: the tab strip sits there, so the shadow never lands on the white page */}
        <div class="relative z-[4] flex min-w-0 flex-1 flex-col">
          <Tabs />
          <Show when={repo.pull}>
            <div class="min-h-0 flex-1 overflow-auto bg-bg">
              <Show
                when={pr()}
                fallback={
                  <div class="mx-auto my-[20vh] max-w-[440px] px-6 text-[14px] text-muted">
                    {pulls.loaded ? `Pull request #${repo.pull} isn't open.` : "Loading…"}
                    <Show when={pulls.loaded}>
                      {" "}
                      <a class="underline" href={`https://github.com/${full()}/pull/${repo.pull}`} target="_blank" rel="noopener">
                        See it on GitHub
                      </a>
                    </Show>
                  </div>
                }
              >
                {(p) => <PrOverview pr={p()} />}
              </Show>
            </div>
          </Show>
          {/* hidden, not unmounted, under a PR's tab: CodeMirror and the doc's scroll stay as they were */}
          <div id="doc" class="group/doc relative min-h-0 flex-1 overflow-auto bg-bg" hidden={!!repo.pull}>
            {/* a file being opened shows its spinner at once, not the file it replaces */}
            <Show
              when={!doc.opening && doc.session}
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
                  <Show when={doc.draftNote}>
                    {/* floats in the doc's top padding instead of pushing the text down */}
                    <div class="sticky top-0 z-[5] h-0">
                      <p class="mx-auto mt-1.5 max-w-[560px] rounded-xl bg-yellow-bg px-3 py-1.5">{doc.draftNote}</p>
                    </div>
                  </Show>
                  <Show when={!isReading()}>
                    <IconPicker icon={icon()} />
                  </Show>
                  <Editor session={s} marks={marks} changes={changes} threads={threads} />
                  {/* Figma 137:2487: pinned to the doc's bottom-right corner while it scrolls: the pencil that switches
                      editing and reading (faded; read-only docs stay in reading) and the word count. The branch and
                      its state are at the file sidebar's foot. */}
                  <div class="sticky bottom-0 z-[5] h-0">
                    <p class="absolute right-0 bottom-0 flex h-6 max-w-full items-center gap-2.5 rounded-tl-xl border-t-[.4px] border-l-[.4px] border-rule bg-card px-3 font-light whitespace-nowrap text-muted">
                      <button
                        class={`cursor-pointer rounded hover:bg-hover disabled:cursor-default disabled:hover:bg-transparent ${isReading() ? "opacity-40" : ""}`}
                        disabled={!s.canWrite}
                        aria-pressed={!isReading()}
                        title={!s.canWrite ? "Read-only" : isReading() ? "Reading: click to edit" : "Editing: click to read"}
                        onClick={toggleReading}
                      >
                        <EditIcon />
                      </button>
                      <span>{size().words} words</span>
                      <span>{size().chars} characters</span>
                    </p>
                  </div>
                </>
              )}
            </Show>
          </div>
        </div>
        {/* no top edge: the header's bottom line is this frame's top too (Figma's centred strokes overlap) */}
        {/* Esc in the panel (outside a field, which keeps its own Esc) goes back to the doc */}
        <aside
          id="panel"
          aria-label="Side panel"
          hidden={!onDoc() || repo.panelHidden}
          class="w-80 shrink-0 overflow-auto border-[.5px] border-t-0 border-line bg-side px-3 py-4"
          onKeyDown={(e) => e.key === "Escape" && !e.defaultPrevented && !(e.target as Element).matches("input, textarea, select") && focusEditor()}
        >
          <div class="mb-4">{tabs()}</div>
          <Show when={doc.session} keyed>
            {(s) => (
              <>
                <div id="history" role="tabpanel" aria-labelledby="tab-history" hidden={tab() !== "history"}>
                  <History session={s} entries={history} />
                </div>
                <div id="comments" role="tabpanel" aria-labelledby="tab-comments" class="flex flex-col gap-4" hidden={tab() !== "comments"}>
                  <CommentsPanel canComment={s.canWrite || comments.viaPr || targetPr() !== null} threads={threads} />
                </div>
                {/* mounted only while shown: it follows the doc's scroll */}
                <Show when={tab() === "outline"}>
                  <div id="outline" role="tabpanel" aria-labelledby="tab-outline">
                    <Outline />
                  </div>
                </Show>
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

// Figma 140:2830: the open tabs over the doc: files (all on the workspace's branch) and pull requests' descriptions.
// The open one is the page's white, 3px wider on each side and running into the doc; a hovered one is a grey pill; a
// 1px rule parts two tabs unless either is open or hovered. A file still opening shows a spinner.
// Like Chrome's and Obsidian's, tabs are up to 200px and shrink to share the strip; only past their 56px minimum do
// they scroll sideways, without a scrollbar (trackpad, wheel; the open tab scrolls into view). "+" stays in sight.
// Keyboard: Left/Right/Home/End move between tabs, Delete or Backspace closes the focused one.
function Tabs() {
  let nav!: HTMLElement;
  // closing the focused tab (or its ×) focuses the tab that takes its place
  const close = (t: Tab) => {
    const i = repo.tabs.findIndex((x) => sameTab(x, t)), focused = nav.contains(document.activeElement);
    closeTab(t);
    if (focused) nav.querySelectorAll("a")[Math.min(i, repo.tabs.length - 1)]?.focus();
  };
  createEffect(() => {
    activeTab();
    nav.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
  const label = (t: Tab) => {
    if ("pull" in t) {
      const p = pulls.list.find((x) => x.number === t.pull);
      return { name: `#${t.pull}${p ? ` ${prTitle(p)}` : ""}`, title: p ? `#${t.pull} ${p.title}` : `Pull request #${t.pull}` };
    }
    return { name: t.path.split("/").pop()!, title: t.path };
  };
  return (
    <div class="flex h-[35px] shrink-0 items-center bg-side">
      <nav
        ref={nav}
        id="tabs"
        aria-label="Open tabs"
        class="flex h-full min-w-0 items-center gap-[5px] overflow-x-auto px-[3px] [scrollbar-width:none]"
        onWheel={(e) => !e.deltaX && (nav.scrollLeft += e.deltaY)}
        onKeyDown={(e) => listKeys(e, "a", true)}
      >
        <For each={repo.tabs}>
          {(t) => {
            const on = () => sameTab(t, activeTab());
            const l = () => label(t);
            return (
              <div
                class={`group/tab relative flex h-full w-[200px] min-w-14 shrink items-center after:absolute after:top-1/2 after:-right-[3px] after:h-[18px] after:w-px after:-translate-y-1/2 after:rounded-[1px] after:bg-rule hover:after:hidden has-[+:hover]:after:hidden has-[+[data-open]]:after:hidden ${on() ? "after:hidden" : ""}`}
                data-open={on() ? "" : undefined}
                title={l().title}
              >
                <span
                  class={`pointer-events-none absolute ${on() ? "-inset-x-[3px] top-[3px] bottom-0 rounded-t-lg bg-bg" : "inset-x-0 top-1/2 h-[26px] -translate-y-1/2 rounded-lg group-hover/tab:bg-rule"}`}
                />
                <a
                  href={tabUrl(repo.repo!.full_name, t)}
                  aria-current={on() ? "page" : undefined}
                  class="relative flex h-6 min-w-0 flex-1 items-center gap-1.5 px-2"
                  onKeyDown={(e) => (e.key === "Delete" || e.key === "Backspace") && (e.preventDefault(), close(t))}
                >
                  <Show when={"path" in t && t.path === doc.opening}>
                    <span class="shrink-0 scale-75">
                      <Spinner />
                    </span>
                  </Show>
                  <span class="max-w-full truncate">{l().name}</span>
                </a>
                <Show when={repo.tabs.length > 1}>
                  <button
                    class={`relative mr-[3px] shrink-0 cursor-pointer rounded hover:bg-hover focus-visible:opacity-100 ${on() ? "" : "opacity-0 group-hover/tab:opacity-100"}`}
                    aria-label={`Close ${l().name}`}
                    onClick={() => close(t)}
                  >
                    <CloseIcon />
                  </button>
                </Show>
              </div>
            );
          }}
        </For>
      </nav>
      <button class="ml-[5px] grid size-6 shrink-0 cursor-pointer place-items-center rounded-lg hover:bg-rule" title="Open a file in a new tab" aria-label="Open a file in a new tab" onClick={openInNewTab}>
        <PlusIcon />
      </button>
    </div>
  );
}
