// Collapsible tree of the branch's markdown files; opening a file opens its folders, and nothing closes them but the reader.
// Links are plain <a href>: main.tsx's navigate handler turns them into in-page file switches.
// Keyboard: the list is one Tab stop (roving tabindex: the open file's row, then the last one focused). Up/Down/Home/End
// move between shown rows; Right opens a folder, then enters it; Left closes it, or goes up to the row's folder; Enter
// opens a file or toggles a folder; typing goes to the search box; Esc goes back to the doc. In the search box Down
// goes to the first result and Enter opens it.
import { For, Show, createEffect, createMemo, createSignal, onMount, untrack } from "solid-js";
import { comments } from "../comments/commentsStore.ts";
import { selectIcon } from "../doc/docSelectors.ts";
import { doc, editorState, focusEditor, toggleChanges } from "../doc/docStore.ts";
import { ArrowDownIcon, ArrowUpIcon, Avatar, BranchIcon, FileIcon, FindIcon, FolderIcon, NewFileIcon, SearchIcon, badge, field, fine } from "../ui.tsx";
import { togglePalette } from "../palette/paletteStore.ts";
import { encPath } from "../github.ts";
import { isReviewBranch } from "./pulls.ts";
import { blobUrl } from "./repoService.ts";
import { selectMatches, selectTree, type Dir } from "./repoSelectors.ts";
import { createFile, navigateTo, repo, toggleReview } from "./repoStore.ts";
import { pulls, showView } from "../pulls/pullsStore.ts";
import { PullsTree } from "../pulls/PullsTree.tsx";

const href = (path: string) => blobUrl(repo.repo!.full_name, repo.branch, path);
// Figma 129:1342: icons at 12px, 16px deeper per level, 4px from their label
const indent = (depth: number) => ({ "padding-left": `${8 + depth * 16}px` });
// Figma rows: 24px text rows 8px apart; the highlight (Rectangle 5/6) is 25px, 1px past the row each side.
const row =
  "mx-1 mb-[7px] flex h-[25px] cursor-pointer items-center gap-1 whitespace-nowrap rounded pr-3 hover:shadow-[inset_0_0_0_.5px_var(--line),var(--shadow)]";

const byName = (a: string, b: string) => a.localeCompare(b);

// The doc's emoji icon (the start of its first `# ` heading), else the file icon. The open doc's follows its text.
function DocIcon(props: { path: string }) {
  const icon = createMemo(() => {
    if (doc.session?.path !== props.path) return doc.icons[props.path] ?? "";
    doc.version;
    const text = editorState()?.doc;
    return text ? (selectIcon(text)?.icon ?? "") : "";
  });
  return (
    <Show when={icon()} fallback={<FileIcon />}>
      {/* the same 15px box as the file and folder icons */}
      <span class="w-[15px] shrink-0 text-center text-[11px] leading-none">{icon()}</span>
    </Show>
  );
}

export function FileSidebar() {
  const [query, setQuery] = createSignal("");
  // the header's "New file" (Figma 129:1325's "document 6") opens a path form under the Files tab's search
  const [adding, setAdding] = createSignal(false);
  const [error, setError] = createSignal("");
  const tree = createMemo(() => selectTree(repo.docs));
  const matches = createMemo(() => selectMatches(repo.docs, query()));
  // the open file's folder, so "+" in docs/research/x.md suggests docs/research/
  const folder = () => repo.path.split("/").slice(0, -1).map((s) => `${s}/`).join("");
  let nav!: HTMLDivElement, lists: HTMLDivElement | undefined, search!: HTMLInputElement;
  onMount(() => nav.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "center" }));
  // the list's one Tab stop: `to`, else the open file's row, else the first row of the list showing (tree or matches).
  // The Files view mounts afresh each time it's picked: pulls.view brings the stop back.
  const rove = (to?: EventTarget | null) => {
    if (!lists?.isConnected) return;
    const pool = [...lists.querySelectorAll<HTMLElement>(":scope > :not([hidden]) :is(summary, a)")];
    const at = pool.find((r) => r === to) ?? pool.find((r) => r.ariaCurrent === "page") ?? pool[0];
    for (const r of lists.querySelectorAll<HTMLElement>("summary, a")) r.tabIndex = r === at ? 0 : -1;
  };
  createEffect(() => (repo.path, tree(), matches(), pulls.view, rove()));
  const rowKeys = (e: KeyboardEvent) => {
    const row = e.target as HTMLElement;
    if (!lists || !row.matches("summary, a") || e.ctrlKey || e.metaKey || e.altKey) return;
    const shown = [...lists.querySelectorAll<HTMLElement>("summary, a")].filter((r) => r.checkVisibility()); // not in closed folders
    const i = shown.indexOf(row);
    const folder = row.tagName === "SUMMARY" ? (row.parentElement as HTMLDetailsElement) : null;
    const up = (folder ?? row).parentElement?.closest("details")?.querySelector("summary");
    const to =
      e.key === "ArrowDown" ? shown[i + 1]
      : e.key === "ArrowUp" ? shown[i - 1]
      : e.key === "Home" ? shown[0]
      : e.key === "End" ? shown.at(-1)
      : e.key === "ArrowRight" && folder?.open ? shown[i + 1]
      : e.key === "ArrowLeft" && !folder?.open ? up
      : undefined;
    if (to) {
      e.preventDefault();
      to.focus(); // focusin moves the Tab stop
    } else if (folder && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      folder.open = e.key === "ArrowRight";
    } else if (e.key === "Escape") {
      e.preventDefault();
      focusEditor();
    } else if (e.key.length === 1 && e.key !== " ") search.focus(); // the key lands in the box
  };
  // Down: the list's Tab stop (the first match while searching); Enter opens the first match
  const searchKeys = (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    const stop = lists?.querySelector<HTMLElement>('[tabindex="0"]');
    if (e.key === "Escape") {
      e.preventDefault();
      if (!e.currentTarget.value) return focusEditor();
      e.currentTarget.value = "";
      setQuery("");
    } else if (stop?.checkVisibility() && (e.key === "ArrowDown" || (e.key === "Enter" && query().trim()))) {
      e.preventDefault();
      if (e.key === "Enter") stop.click();
      else stop.focus();
    }
  };
  const submit = (e: SubmitEvent & { currentTarget: HTMLFormElement }) => {
    e.preventDefault();
    const err = createFile(new FormData(e.currentTarget).get("path")?.toString() ?? "");
    setError(err ?? "");
    if (!err) setAdding(false);
  };
  return (
    <>
      {/* Figma 140:2895: the collapsed sidebar, a 38px rail with the reader and file search (⌘K) */}
      <div hidden={!repo.filesHidden} class="flex w-[38px] shrink-0 flex-col items-center gap-3.5 border-[.5px] border-t-0 border-line bg-side pt-1">
        <Avatar login={repo.user!.login} size={28} />
        <button class="-translate-x-[1.5px] cursor-pointer rounded hover:bg-hover" title="Find a file (⌘K)" aria-label="Find a file" onClick={togglePalette}>
          <FindIcon />
        </button>
      </div>
      {/* The Figma stroke is an overlay on a non-scrolling wrapper: an outline on the scroller is painted under its sticky header.
          No top edge: Figma's centred strokes put the header's and this frame's on one line, which the header draws. */}
      <nav
        id="files"
        aria-label="Files"
        hidden={repo.filesHidden}
        class="relative flex w-80 shrink-0 flex-col bg-side after:pointer-events-none after:absolute after:inset-0 after:z-[2] after:border-[.5px] after:border-t-0 after:border-line"
      >
        <div ref={nav} class="flex min-h-0 flex-1 flex-col overflow-auto pb-6">
          {/* Figma 129:1325 */}
          <div class="flex h-9 shrink-0 items-center gap-2 px-3 py-1 shadow-figma">
            <Avatar login={repo.user!.login} size={28} />
            <a href={`/${repo.repo!.full_name}/tree/${encPath(repo.branch)}`} class="truncate hover:underline" title={`Signed in as ${repo.user!.login}`}>
              {repo.repo!.full_name}
            </a>
            <Show when={repo.repo!.permissions?.push}>
              <button
                class="ml-auto shrink-0 cursor-pointer rounded hover:bg-hover"
                title="New file"
                aria-label="New file"
                aria-expanded={adding()}
                onClick={() => (setError(""), setAdding(pulls.view !== "files" || !adding()), showView("files"))}
              >
                <NewFileIcon />
              </button>
            </Show>
          </div>
          {/* the branch's files, or the repo's open pull requests (pulls/PullsTree.tsx), VS Code's GitHub view style */}
          <div class="flex shrink-0 gap-1 px-3 pt-2 pb-1" role="tablist" aria-label="Sidebar">
            {(["files", "pulls"] as const).map((v) => (
              <button
                role="tab"
                aria-selected={pulls.view === v}
                class={`h-6 cursor-pointer rounded-xl px-2.5 ${pulls.view === v ? "bg-card text-fg shadow-figma" : "text-muted hover:text-fg"}`}
                onClick={() => showView(v)}
              >
                {v === "files" ? "Files" : `Pull requests${pulls.list.length ? ` ${pulls.list.length}` : ""}`}
              </button>
            ))}
          </div>
          <Show when={pulls.view === "files"} fallback={<PullsTree />}>
          <div class="sticky top-0 z-[1] flex items-center gap-2 bg-side px-3 py-1">
            <label class={`${field} flex min-w-0 flex-1 items-center gap-2`}>
              <SearchIcon />
              <input
                ref={search}
                type="search"
                aria-label="Find a file"
                placeholder="Find a file"
                class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-mark"
                onInput={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={searchKeys}
              />
            </label>
            <span class="text-muted">{repo.docs.length} docs</span>
          </div>
          <Show when={adding()}>
            <form class="px-3 pb-3" onSubmit={submit}>
              <input
                name="path"
                aria-label="New file path"
                value={folder()}
                placeholder="folder/name.md"
                spellcheck={false}
                class={`${field} w-full outline-none`}
                ref={(el) => requestAnimationFrame(() => (el.focus(), el.setSelectionRange(el.value.length, el.value.length)))}
                onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
              />
              <p class={`${fine} mb-0`}>{error() || "Enter to create · Esc to cancel"}</p>
            </form>
          </Show>
          <div ref={lists} onKeyDown={rowKeys} onFocusIn={(e) => rove(e.target)}>
          <div class="mt-1" hidden={!!query().trim()}>
            <DirView dir={tree()} prefix="" depth={0} />
          </div>
          <div class="mt-1" hidden={!query().trim()}>
            <Show when={matches().length} fallback={<p class="px-3 py-3 text-muted">No files match.</p>}>
              <For each={matches()}>
                {(p) => (
                  <a class="mx-1 mb-[7px] flex min-h-[25px] items-center gap-1 rounded py-[5px] pr-3 pl-2 hover:shadow-[inset_0_0_0_.5px_var(--line),var(--shadow)]" href={href(p)}>
                    <DocIcon path={p} />
                    <span>{p}</span>
                  </a>
                )}
              </For>
            </Show>
          </div>
          </div>
          </Show>
        </div>
        <BranchBar />
      </nav>
    </>
  );
}

// VS Code's status bar item, at the sidebar's foot: the branch every file and tab is on (a picker: switching it
// switches them all), then what's special about it: read-only, protected, the review mode. A draft's own actions
// (Changes, Bring in edits, Publish…) are in its bar over the doc (pulls/DraftBar.tsx).
function BranchBar() {
  const draft = createMemo(() => {
    doc.version;
    return doc.session?.doc.base;
  });
  // every branch of the repo but Red Letter's own (red-letter/comments/…, red-letter/review/…: hashed names nobody
  // picks), unless it's the one open: this one first, then its base, the default branch, yours, the rest alphabetically
  const branches = () => {
    const login = `${repo.user?.login}/`;
    const rest = repo.branches.filter((b) => !b.startsWith("red-letter/")).sort((a, b) => Number(b.startsWith(login)) - Number(a.startsWith(login)) || a.localeCompare(b));
    return [...new Set([repo.branch, draft()?.branch ?? "", repo.repo?.default_branch ?? "", ...rest])].filter(Boolean);
  };
  const pick = (sel: HTMLSelectElement) => {
    const branch = sel.value;
    sel.value = repo.branch; // the route decides which branch shows
    navigateTo(blobUrl(repo.repo!.full_name, branch, repo.path));
  };
  return (
    <div class="flex h-7 shrink-0 items-center gap-2 border-t-[.5px] border-line px-3 font-light whitespace-nowrap text-muted">
      <label class="inline-flex min-w-0 items-center gap-1 text-fg" title="Switch branch: every file and tab moves to it">
        <BranchIcon />
        <select class="min-w-0 cursor-pointer truncate bg-transparent font-normal [field-sizing:content]" aria-label="Branch" onChange={(e) => pick(e.currentTarget)}>
          <For each={branches()}>
            {(b) => (
              <option value={b} selected={b === repo.branch}>
                {isReviewBranch(b) ? "review" : b}
              </option>
            )}
          </For>
        </select>
      </label>
      <Show when={!repo.repo?.permissions?.push}>
        <span class={`${badge} px-1.5`}>read-only</span>
      </Show>
      <Show when={comments.viaPr}>
        <span class={`${badge} px-1.5`} title={`${repo.branch} is protected: no edits here; comments go through a pull request`}>
          protected
        </span>
      </Show>
      {/* the mode: working on the branch, or reviewing its PR (its changes lit against the PR's base). Never automatic. */}
      <Show when={pulls.reviewing ?? doc.pr}>
        {(pr) => (
          <button
            class={`${badge} cursor-pointer px-1.5 hover:text-fg ${pulls.reviewing ? "bg-on text-fg" : ""}`}
            aria-pressed={!!pulls.reviewing}
            title={pulls.reviewing ? "Stop reviewing: back to working on the branch" : `Review pull request #${pr().number}: its changes against ${pr().base} lit`}
            onClick={toggleReview}
          >
            {pulls.reviewing ? `Reviewing #${pr().number} ×` : `Review #${pr().number}`}
          </button>
        )}
      </Show>
      {/* reviewing a branch that isn't a draft (a draft's bar has its own Changes): its changes against the PR's base */}
      <Show when={!draft() && doc.reviewBase !== null && pulls.reviewing?.base}>
        {(base) => (
          <button
            class={`${badge} cursor-pointer px-1.5 hover:text-fg ${doc.showChanges ? "bg-on text-fg" : ""}`}
            aria-pressed={doc.showChanges}
            title={`Highlight what this branch changed from ${base()}`}
            onClick={toggleChanges}
          >
            Changes
          </button>
        )}
      </Show>
    </div>
  );
}

function DirView(props: { dir: Dir; prefix: string; depth: number }) {
  return (
    <>
      <For each={Object.keys(props.dir.dirs).sort(byName)}>
        {(name) => {
          const dir = `${props.prefix}${name}/`;
          let details!: HTMLDetailsElement;
          // open (never close) when the open file is inside: switching files keeps the folders the reader opened.
          // The first render opens them in markup, so the sidebar's onMount can scroll to the file.
          createEffect(() => repo.path.startsWith(dir) && (details.open = true));
          return (
            <details ref={details} open={untrack(() => repo.path.startsWith(dir))}>
              <summary class={`${row} list-none`} style={indent(props.depth)}>
                <FolderIcon />
                <span class="truncate">{name}</span>
                <ArrowUpIcon />
                <ArrowDownIcon />
              </summary>
              <DirView dir={props.dir.dirs[name]} prefix={dir} depth={props.depth + 1} />
            </details>
          );
        }}
      </For>
      <For each={props.dir.files.slice().sort(byName)}>
        {(p) => (
          <a
            class={`${row} ${p === repo.path ? "bg-on shadow-figma" : ""}`}
            aria-current={p === repo.path ? "page" : undefined}
            href={href(p)}
            style={indent(props.depth)}
          >
            <DocIcon path={p} />
            <span class="truncate">{p.split("/").pop()}</span>
          </a>
        )}
      </For>
    </>
  );
}
