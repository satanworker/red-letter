// Collapsible tree of the branch's markdown files; opening a file opens its folders, and nothing closes them but the reader.
// Links are plain <a href>: main.tsx's navigate handler turns them into in-page file switches.
// Keyboard: Tab reaches the rows, Up/Down move between visible rows, Enter opens a file or toggles a folder.
import { For, Show, createEffect, createMemo, createSignal, onMount, untrack } from "solid-js";
import { selectIcon } from "../doc/docSelectors.ts";
import { doc, editorState } from "../doc/docStore.ts";
import { ArrowDownIcon, ArrowUpIcon, Avatar, FileIcon, FindIcon, FolderIcon, SearchIcon, field, fine } from "../ui.tsx";
import { togglePalette } from "../palette/paletteStore.ts";
import { encPath } from "../github.ts";
import { blobUrl } from "./repoService.ts";
import { selectMatches, selectTree, type Dir } from "./repoSelectors.ts";
import { createFile, repo } from "./repoStore.ts";

const href = (path: string) => blobUrl(repo.repo!.full_name, repo.branch, path);
// Figma 129:1342: icons at 12px, 16px deeper per level, 4px from their label
const indent = (depth: number) => ({ "padding-left": `${8 + depth * 16}px` });
// Figma rows: 24px text rows 8px apart; the highlight (Rectangle 5/6) is 25px, 1px past the row each side.
const row =
  "mx-1 mb-[7px] flex h-[25px] cursor-pointer items-center gap-1 whitespace-nowrap rounded pr-3 hover:shadow-[inset_0_0_0_.5px_var(--line),var(--shadow)]";

// Up/Down between the rows the tree shows (summaries and file links whose folders are open)
function moveFocus(e: KeyboardEvent) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const rows = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("summary, a")].filter((r) => r.offsetParent);
  const i = rows.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  e.preventDefault();
  rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
}
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
  // The "New file" button is out of the Nov 5 design for now; the form stays for when it comes back.
  const [adding, setAdding] = createSignal(false);
  const [error, setError] = createSignal("");
  const tree = createMemo(() => selectTree(repo.docs));
  const matches = createMemo(() => selectMatches(repo.docs, query()));
  // the open file's folder, so "+" in docs/research/x.md suggests docs/research/
  const folder = () => repo.path.split("/").slice(0, -1).map((s) => `${s}/`).join("");
  let nav!: HTMLDivElement;
  onMount(() => nav.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "center" }));
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
        class="relative w-80 shrink-0 bg-side after:pointer-events-none after:absolute after:inset-0 after:z-[2] after:border-[.5px] after:border-t-0 after:border-line"
      >
        <div ref={nav} class="h-full overflow-auto pb-6">
          {/* Figma 129:1325 */}
          <div class="flex h-9 items-center gap-2 px-3 py-1 shadow-figma">
            <Avatar login={repo.user!.login} size={28} />
            <a href={`/${repo.repo!.full_name}/tree/${encPath(repo.branch)}`} class="truncate hover:underline" title={`Signed in as ${repo.user!.login}`}>
              {repo.repo!.full_name}
            </a>
          </div>
          <div class="sticky top-0 z-[1] flex items-center gap-2 bg-side px-3 py-1">
            <label class={`${field} flex min-w-0 flex-1 items-center gap-2`}>
              <SearchIcon />
              <input
                type="search"
                aria-label="Find a file"
                placeholder="Find a file"
                class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-mark"
                onInput={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={(e) => e.key === "Escape" && ((e.currentTarget.value = ""), setQuery(""))}
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
          <div class="mt-1" hidden={!!query().trim()} onKeyDown={moveFocus}>
            <DirView dir={tree()} prefix="" depth={0} />
          </div>
          <div class="mt-1" hidden={!query().trim()} onKeyDown={moveFocus}>
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
      </nav>
    </>
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
