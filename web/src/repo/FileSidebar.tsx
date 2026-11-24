// Collapsible tree of the branch's markdown files; opening a file opens its folders, and nothing closes them but the reader.
// Links are plain <a href>: main.tsx's navigate handler turns them into in-page file switches.
// Keyboard: the list is one Tab stop (roving tabindex: the open file's row, then the last one focused). Up/Down/Home/End
// move between shown rows; Right opens a folder, then enters it; Left closes it, or goes up to the row's folder; Enter
// opens a file or toggles a folder; typing goes to the search box; Esc goes back to the doc. In the search box Down
// goes to the first result and Enter opens it.
// Rows drag (push access): a file or a folder (with all it holds) dropped on a folder, or a file in it, moves there;
// anywhere else in the tree, to the root. One commit (repoStore.moveTo); a closed folder opens when held over.
// Every row has a "…" on hover (Figma 190:1914; the context-menu key, Shift+F10 or a right click open it too): open in
// a new tab, duplicate, move to a folder, open on GitHub, rename in place, delete (asked in the menu).
import { For, Show, createEffect, createMemo, createSignal, onMount, untrack } from "solid-js";
import { comments } from "../comments/commentsStore.ts";
import { selectIcon } from "../doc/docSelectors.ts";
import { doc, editorState, focusEditor, toggleChanges } from "../doc/docStore.ts";
import { ArrowDownIcon, ArrowUpIcon, Avatar, BranchBarIcon, DotsIcon, FileIcon, FindIcon, FolderIcon, MenuRule, NewFileIcon, SearchIcon, badge, field, iconBtn, listKeys, menuCard, menuItem, placeMenu, pressed, rowHover } from "../ui.tsx";
import { togglePalette } from "../palette/paletteStore.ts";
import { encPath } from "../github.ts";
import { isReviewBranch } from "./pulls.ts";
import { blobUrl } from "./repoService.ts";
import { selectFolders, selectMatches, selectMoveTarget, selectTree, type Dir } from "./repoSelectors.ts";
import { cancelCreate, cancelRename, deletePath, duplicatePath, moveTo, nameNew, navigateTo, openInBackground, renamePath, repo, startCreate, startRename, toggleReview } from "./repoStore.ts";
import { pulls, showView } from "../pulls/pullsStore.ts";
import { PullsTree } from "../pulls/PullsTree.tsx";

const href = (path: string) => blobUrl(repo.repo!.full_name, repo.branch, path);
// Figma 129:1342: icons at 12px, 16px deeper per level, 4px from their label
const indent = (depth: number) => ({ "padding-left": `${8 + depth * 16}px` });
// Figma rows: 24px text rows 8px apart; the highlight (184:1168 hovered, 184:1169 open) is 25px, 1px past the row each side.
const row = `mx-1 mb-[7px] flex h-[25px] cursor-pointer items-center gap-1 whitespace-nowrap rounded pr-3 ${rowHover}`;

const byName = (a: string, b: string) => a.localeCompare(b);

// The doc's emoji icon (the start of its first `# ` heading), else the file icon. The open doc's follows its text.
function DocIcon(props: { path: string }) {
  const icon = createMemo(() => {
    if (doc.session?.path !== props.path) return doc.icons[props.path] ?? "";
    doc.version;
    const text = editorState()?.doc;
    // no editor yet (the doc just swapped in): the icon noted when it opened, not the file icon for a frame
    return text ? (selectIcon(text)?.icon ?? "") : (doc.icons[props.path] ?? "");
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
  const [error, setError] = createSignal("");
  const canWrite = () => repo.repo?.permissions?.push === true;
  const tree = createMemo(() => selectTree(repo.docs));
  const matches = createMemo(() => selectMatches(repo.docs, query()));
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
    } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      rowMenu(row);
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
  // the naming row (Figma 180:411's flow): Enter names it (a folder then asks for its first file), Esc or leaving it
  // empty cancels
  const submit = (e: SubmitEvent & { currentTarget: HTMLFormElement }) => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("name") as HTMLInputElement;
    const err = nameNew(input.value);
    setError(err ?? "");
    if (!err && repo.naming) input.value = ""; // the folder took its name: now its first file's
  };
  const cancel = () => (setError(""), cancelCreate());

  // Drag and drop. What's dragged (a path, or "dir/") and the folder it would land in ("" the root) are this tree's
  // own business; dropping calls moveTo. Drags from elsewhere (files, text) find nothing here.
  const [drag, setDrag] = createSignal("");
  const [over, setOver] = createSignal<string | null>(null);
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let openFor: Element | null = null;
  const endDrag = () => (setDrag(""), setOver(null), clearTimeout(openTimer), (openFor = null));
  const dragStart = (e: DragEvent) => {
    const from = (e.target as Element).closest?.("[data-drag]")?.getAttribute("data-drag");
    if (!from || !canWrite()) return;
    e.dataTransfer!.setData("text/plain", from);
    e.dataTransfer!.effectAllowed = "move";
    setDrag(from);
  };
  const dragOver = (e: DragEvent) => {
    const src = drag();
    if (!src) return;
    const folder = (e.target as Element).closest?.("details[data-dir]") ?? null;
    const dir = folder?.getAttribute("data-dir") ?? "";
    if (selectMoveTarget(src, dir) === null) return setOver(null);
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";
    setOver(dir);
    // held over a closed folder's own row: it opens, so the drop can go deeper
    const summary = (e.target as Element).closest?.("summary");
    const closed = summary?.parentElement instanceof HTMLDetailsElement && !summary.parentElement.open ? summary.parentElement : null;
    if (closed !== openFor) {
      clearTimeout(openTimer);
      openFor = closed;
      if (closed) openTimer = setTimeout(() => (closed.open = true), 600);
    }
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    const src = drag(), dir = over();
    endDrag();
    if (src && dir !== null) void moveTo(src, dir);
  };
  // The rows' "…" (Figma 190:1914): one menu for the tree, under the "…" that opened it, its left edge on the button's.
  // It has three faces: the actions, the folders to move to (with a search), and "delete this?". Pressing the "…" whose
  // menu is open closes it (light dismiss closes it on the press, and the click would open it again).
  let menu!: HTMLDivElement;
  const [menuFor, setMenuFor] = createSignal(""); // a path, or "dir/"
  const [face, setFace] = createSignal<"actions" | "move" | "delete">("actions");
  const [where, setWhere] = createSignal("");
  const [menuOpen, setMenuOpen] = createSignal(false);
  let wasOpen: boolean | undefined;
  const folders = createMemo(() => selectFolders(repo.docs));
  const nameOf = (p: string) => p.replace(/\/$/, "").split("/").pop()!;
  const openMenu = (path: string, by: HTMLElement) => {
    const close = wasOpen ?? (menuOpen() && menuFor() === path);
    wasOpen = undefined;
    if (menuOpen()) menu.hidePopover();
    if (close) return;
    setMenuFor(path);
    setFace("actions");
    setWhere("");
    placeMenu(menu, by, "below", "start");
    menu.showPopover();
    menu.querySelector("button")?.focus();
  };
  const dots = (path: string) => ({
    down: () => (wasOpen = menuOpen() && menuFor() === path),
    open: (by: HTMLElement) => openMenu(path, by),
    shown: () => menuOpen() && menuFor() === path,
  });
  // a row's menu from the keyboard or a right click: under its "…"
  const rowMenu = (row: Element) => {
    const by = row.querySelector<HTMLElement>("[data-dots]") ?? row.parentElement?.querySelector<HTMLElement>(":scope > [data-dots]");
    const path = by?.dataset.dots;
    if (by && path) openMenu(path, by);
  };
  const act = (run: () => unknown) => () => {
    menu.hidePopover();
    void run();
  };
  const ghUrl = (p: string) => `https://github.com/${repo.repo!.full_name}/${p.endsWith("/") ? "tree" : "blob"}/${encPath(repo.branch)}/${encPath(p.replace(/\/$/, ""))}`;
  const destinations = () => {
    const q = where().trim().toLowerCase();
    return ["", ...folders()].filter((d) => selectMoveTarget(menuFor(), d) !== null && (!q || (d || "root").toLowerCase().includes(q)));
  };
  // rename in place: Enter renames, Esc or leaving it unchanged cancels
  const renameKeys = (e: KeyboardEvent & { currentTarget: HTMLInputElement }, path: string) => {
    e.stopPropagation(); // not the tree's keys, and Space doesn't toggle a folder
    if (e.key === "Escape") return (e.preventDefault(), cancelRename());
    if (e.key !== "Enter") return;
    e.preventDefault();
    const err = renamePath(path, e.currentTarget.value);
    if (err) e.currentTarget.setCustomValidity(err), e.currentTarget.reportValidity();
  };

  return (
    <>
      {/* Figma 140:2895: the collapsed sidebar, a 38px rail with the reader and file search (⌘K) */}
      <div hidden={!repo.filesHidden} class="flex w-[38px] shrink-0 flex-col items-center gap-3.5 border-[.5px] border-t-0 border-line bg-side pt-1">
        <Avatar login={repo.user!.login} size={28} />
        <button class={iconBtn} title="Find a file (⌘K)" aria-label="Find a file" onClick={togglePalette}>
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
        <div ref={nav} class="flex min-h-0 flex-1 flex-col overflow-auto pt-2 pb-6">
          {/* Figma 180:195: you and the New file button (no divider under them) */}
          <div class="flex h-9 shrink-0 items-center gap-2 px-3">
            <Avatar login={repo.user!.login} size={28} />
            <span class="truncate" title={`Signed in as ${repo.user!.login} · ${repo.repo!.full_name}`}>
              {repo.user!.login}
            </span>
            <Show when={canWrite()}>
              {/* mousedown keeps focus in an open naming row, so its blur doesn't cancel it before the click toggles it */}
              <button
                class={`ml-auto ${iconBtn}`}
                title="New file"
                aria-label="New file"
                aria-expanded={!!repo.naming}
                onMouseDown={(e) => repo.naming && e.preventDefault()}
                onClick={() => (repo.naming ? cancel() : startCreate("file"))}
              >
                <NewFileIcon />
              </button>
            </Show>
          </div>
          {/* Figma 180:204: search, over both lists (typing in it shows the Files view's matches) */}
          <div class="sticky top-0 z-[1] flex shrink-0 items-center gap-2 bg-side px-3 py-2">
            <label class={`${field} flex min-w-0 flex-1 items-center gap-2`}>
              <SearchIcon />
              <input
                ref={search}
                type="search"
                aria-label="Find a file"
                placeholder="Find a file"
                class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-mark"
                onInput={(e) => (setQuery(e.currentTarget.value), pulls.view !== "files" && showView("files"))}
                onKeyDown={searchKeys}
              />
            </label>
            <span class="text-muted">{repo.docs.length} docs</span>
          </div>
          {/* Figma 184:1104: the branch's files, or the repo's open pull requests (pulls/PullsTree.tsx) */}
          <div class="flex shrink-0 gap-2 px-3 py-1" role="tablist" aria-label="Sidebar">
            {(["files", "pulls"] as const).map((v) => (
              <button
                role="tab"
                aria-selected={pulls.view === v}
                class={`h-7 cursor-pointer rounded-[14px] shadow-figma ${pulls.view === v ? "bg-card px-4 text-fg" : "border-[.4px] border-line bg-side px-3 text-muted hover:text-fg"}`}
                onClick={() => showView(v)}
              >
                {v === "files" ? "Files" : `Pull request${pulls.list.length ? ` ${pulls.list.length}` : ""}`}
              </button>
            ))}
          </div>
          <Show when={pulls.view === "files"} fallback={<PullsTree />}>
          <div
            ref={lists}
            class="flex flex-1 flex-col"
            onKeyDown={rowKeys}
            onFocusIn={(e) => rove(e.target)}
            onContextMenu={(e) => {
              const row = (e.target as Element).closest("summary, [data-row]");
              if (row && !(e.target as Element).matches("input")) (e.preventDefault(), rowMenu(row));
            }}
          >
          <div
            class={`mt-1 flex min-h-12 flex-1 flex-col rounded ${over() === "" ? "shadow-[inset_0_0_0_.5px_var(--line)]" : ""}`}
            hidden={!!query().trim()}
            onDragStart={dragStart}
            onDragOver={dragOver}
            onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(null)}
            onDrop={drop}
            onDragEnd={endDrag}
          >
            <DirView dir={tree()} prefix="" depth={0} draggable={canWrite()} over={over()} dots={dots} renameKeys={renameKeys} />
            {/* Figma 180:411's flow: a new file or folder joins the bottom of the root, named in place */}
            <Show when={repo.naming}>
              {(n) => (
                <>
                  <Show when={n().folder}>
                    <div class={`${row} cursor-default`} style={indent(0)}>
                      <FolderIcon />
                      <span class="truncate">{n().folder.slice(0, -1)}</span>
                    </div>
                  </Show>
                  <form class="mx-1 mb-[7px] flex h-[25px] items-center gap-1 pr-3" style={indent(n().folder ? 1 : 0)} onSubmit={submit}>
                    {n().kind === "folder" && !n().folder ? <FolderIcon /> : <FileIcon />}
                    <input
                      name="name"
                      aria-label={n().kind === "folder" && !n().folder ? "New folder name" : "New file name"}
                      value={n().name}
                      placeholder={n().kind === "folder" && !n().folder ? "Folder name" : "File name"}
                      spellcheck={false}
                      class="h-[25px] min-w-0 flex-1 rounded bg-card px-1.5 shadow-[inset_0_0_0_.5px_var(--line)] outline-none"
                      ref={(el) => requestAnimationFrame(() => (el.focus(), el.scrollIntoView({ block: "nearest" })))}
                      onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), cancel())}
                      onBlur={(e) => !e.currentTarget.value.trim() && cancel()}
                    />
                  </form>
                  <p class={`mx-1 mb-[7px] ${error() ? "text-red" : "text-muted"}`} style={indent(n().folder ? 1 : 0)}>
                    {error() || (n().kind === "folder" && !n().folder ? "Enter, then name its first file · Esc to cancel" : "Enter to create · Esc to cancel")}
                  </p>
                </>
              )}
            </Show>
            <Show when={repo.treeNote}>
              {(note) => <p class={`mx-1 px-2 [overflow-wrap:anywhere] ${note().error ? "text-red" : "text-muted"}`}>{note().text}</p>}
            </Show>
          </div>

          <div class="mt-1" hidden={!query().trim()}>
            <Show when={matches().length} fallback={<p class="px-3 py-3 text-muted">No files match.</p>}>
              <For each={matches()}>
                {(p) => (
                  <a class={`mx-1 mb-[7px] flex min-h-[25px] items-center gap-1 rounded py-[5px] pr-3 pl-2 ${rowHover}`} href={href(p)}>
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
      <div
        ref={menu}
        popover
        role="menu"
        aria-label={`${nameOf(menuFor() || "x")} menu`}
        class={`${menuCard} w-[237px]`}
        onToggle={(e) => setMenuOpen(e.newState === "open")}
        onKeyDown={(e) => listKeys(e, "button")}
      >
        <Show when={face() === "actions"}>
          <Show when={!menuFor().endsWith("/")}>
            <button type="button" role="menuitem" class={menuItem} onClick={act(() => openInBackground(href(menuFor())))}>
              Open in new tab
            </button>
            <MenuRule />
          </Show>
          <Show when={canWrite()}>
            <Show when={!menuFor().endsWith("/")}>
              <button type="button" role="menuitem" class={menuItem} onClick={act(() => duplicatePath(menuFor()))}>
                Duplicate
              </button>
            </Show>
            <button type="button" role="menuitem" class={menuItem} onClick={() => (setFace("move"), requestAnimationFrame(() => menu.querySelector("input")?.focus()))}>
              {menuFor().endsWith("/") ? "Move folder to..." : "Move file to..."}
            </button>
            <MenuRule />
          </Show>
          <button type="button" role="menuitem" class={menuItem} onClick={act(() => window.open(ghUrl(menuFor()), "_blank", "noopener"))}>
            Open at GitHub
          </button>
          <Show when={canWrite()}>
            <MenuRule />
            <button type="button" role="menuitem" class={menuItem} onClick={act(() => startRename(menuFor()))}>
              Rename
            </button>
            <button type="button" role="menuitem" class={menuItem} onClick={() => (setFace("delete"), requestAnimationFrame(() => menu.querySelector("button")?.focus()))}>
              Delete
            </button>
          </Show>
        </Show>
        <Show when={face() === "move"}>
          <p class="leading-4 text-muted">Move {nameOf(menuFor())} to</p>
          <input
            class={`${field} w-full outline-none`}
            placeholder="Find a folder"
            aria-label="Find a folder"
            value={where()}
            onInput={(e) => setWhere(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && destinations()[0] !== undefined && act(() => moveTo(menuFor(), destinations()[0]!))()}
          />
          <div class="-mx-1.5 flex max-h-[240px] flex-col gap-2 overflow-auto px-1.5">
            <For each={destinations()} fallback={<p class="leading-4 text-muted">No folder matches.</p>}>
              {(d) => (
                <button type="button" role="menuitem" class={menuItem} onClick={act(() => moveTo(menuFor(), d))}>
                  <FolderIcon />
                  <span class="truncate">{d ? d.slice(0, -1) : "Root"}</span>
                </button>
              )}
            </For>
          </div>
        </Show>
        <Show when={face() === "delete"}>
          <p class="leading-4 text-muted">
            Delete {nameOf(menuFor())}
            {menuFor().endsWith("/") ? " and everything in it" : ""}? Git history keeps {menuFor().endsWith("/") ? "them" : "it"}.
          </p>
          <button type="button" role="menuitem" class={`${menuItem} text-red`} onClick={act(() => deletePath(menuFor()))}>
            Delete
          </button>
          <button type="button" role="menuitem" class={menuItem} onClick={() => setFace("actions")}>
            Cancel
          </button>
        </Show>
      </div>
    </>
  );
}

// VS Code's status bar item, at the sidebar's foot (Figma 185:1581): the branch every file and tab is on (a picker:
// switching it switches them all), then what's special about it: read-only, protected, the review mode. A draft's own
// actions (Changes, Bring in edits, Publish…) are in its bar over the doc (pulls/DraftBar.tsx).
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
    <div class="flex shrink-0 items-center gap-2.5 border-t-[.5px] border-line p-2.5 font-light whitespace-nowrap text-muted shadow-figma">
      <label class="inline-flex min-w-0 items-center gap-2.5 text-fg" title="Switch branch: every file and tab moves to it">
        <BranchBarIcon />
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

type Dots = (path: string) => { down: () => void; open: (by: HTMLElement) => void; shown: () => boolean };
type RenameKeys = (e: KeyboardEvent & { currentTarget: HTMLInputElement }, path: string) => void;

// A row's "…": shown while the row is hovered or focused, or its menu is open (then pressed, Figma 190:1914)
function DotsButton(props: { path: string; dots: Dots }) {
  const d = props.dots(props.path);
  return (
    <button
      type="button"
      tabindex={-1}
      data-dots={props.path}
      class={`absolute top-[2.5px] right-1.5 ${iconBtn} ${d.shown() ? "" : "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100"}`}
      aria-label="More"
      aria-haspopup="menu"
      aria-expanded={d.shown()}
      onPointerDown={d.down}
      onClick={(e) => (e.preventDefault(), e.stopPropagation(), d.open(e.currentTarget))}
    >
      <DotsIcon />
    </button>
  );
}

// a row's name being typed (Rename): in the label's place
function RenameInput(props: { path: string; renameKeys: RenameKeys }) {
  const name = props.path.replace(/\/$/, "").split("/").pop()!;
  return (
    <input
      value={name}
      aria-label={`New name for ${name}`}
      spellcheck={false}
      class="h-[21px] min-w-0 flex-1 rounded bg-card px-1 shadow-[inset_0_0_0_.5px_var(--line)] outline-none"
      ref={(el) =>
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(0, name.replace(/\.[^.]+$/, "").length || name.length); // the name, not its extension
        })
      }
      onClick={(e) => (e.preventDefault(), e.stopPropagation())}
      onKeyDown={(e) => props.renameKeys(e, props.path)}
      onKeyUp={(e) => e.stopPropagation()}
      onInput={(e) => e.currentTarget.setCustomValidity("")}
      onBlur={(e) => (e.currentTarget.value.trim() === name || !e.currentTarget.value.trim()) && cancelRename()}
    />
  );
}

function DirView(props: { dir: Dir; prefix: string; depth: number; draggable: boolean; over: string | null; dots: Dots; renameKeys: RenameKeys }) {
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
            <details ref={details} open={untrack(() => repo.path.startsWith(dir))} data-dir={dir}>
              <summary
                class={`${row} group/row relative list-none pr-8 ${props.over === dir ? pressed : ""}`}
                style={indent(props.depth)}
                draggable={props.draggable && repo.renaming !== dir}
                data-drag={dir}
              >
                <FolderIcon />
                <Show when={repo.renaming === dir} fallback={<span class="truncate">{name}</span>}>
                  <RenameInput path={dir} renameKeys={props.renameKeys} />
                </Show>
                <ArrowUpIcon />
                <ArrowDownIcon />
                <DotsButton path={dir} dots={props.dots} />
              </summary>
              <DirView dir={props.dir.dirs[name]} prefix={dir} depth={props.depth + 1} draggable={props.draggable} over={props.over} dots={props.dots} renameKeys={props.renameKeys} />
            </details>
          );
        }}
      </For>
      <For each={props.dir.files.slice().sort(byName)}>
        {(p) => (
          // the "…" sits beside the link, not in it (a button can't be inside a link)
          <div class="group/row relative">
            <Show
              when={repo.renaming === p}
              fallback={
                <a
                  class={`${row} pr-8 ${p === repo.path ? pressed : ""}`}
                  aria-current={p === repo.path ? "page" : undefined}
                  href={href(p)}
                  style={indent(props.depth)}
                  draggable={props.draggable}
                  data-drag={p}
                  data-row
                >
                  <DocIcon path={p} />
                  <span class="truncate">{p.split("/").pop()}</span>
                </a>
              }
            >
              <div class={`${row} pr-8 ${pressed}`} style={indent(props.depth)}>
                <DocIcon path={p} />
                <RenameInput path={p} renameKeys={props.renameKeys} />
              </div>
            </Show>
            <DotsButton path={p} dots={props.dots} />
          </div>
        )}
      </For>
    </>
  );
}
