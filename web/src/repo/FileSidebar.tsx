// Collapsible tree of the branch's markdown files; folders on the current file's path are open.
// Links are plain <a href>: main.tsx's navigate handler turns them into in-page file switches.
// Keyboard: Tab reaches the rows, Up/Down move between visible rows, Enter opens a file or toggles a folder.
import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import { selectIcon } from "../doc/docSelectors.ts";
import { doc } from "../doc/docStore.ts";
import { ArrowDownIcon, ArrowUpIcon, FileIcon, FolderIcon, NewDocIcon, SearchIcon, SidebarIcon, field, fine } from "../ui.tsx";
import { blobUrl } from "./repoService.ts";
import { selectMatches, selectTree, type Dir } from "./repoSelectors.ts";
import { createFile, repo, toggleFiles } from "./repoStore.ts";

const href = (path: string) => blobUrl(repo.repo!.full_name, repo.branch, path);
const indent = (depth: number) => ({ "padding-left": `${12 + depth * 20}px` });
// Figma rows: 23px text rows 8px apart; the highlight (Rectangle 5/6) is 25px, 1px past the row each side.
const row =
  "mx-1 mb-1.5 flex h-[25px] cursor-pointer items-center gap-2 whitespace-nowrap rounded pr-3 hover:shadow-[inset_0_0_0_.5px_var(--line),var(--shadow)]";

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
    return selectIcon(doc.session.doc.text)?.icon ?? "";
  });
  return (
    <Show when={icon()} fallback={<FileIcon />}>
      {/* 14px wide, 2px into the gap each side: the name stays where the 10px file icon puts it */}
      <span class="-mx-0.5 w-3.5 shrink-0 text-center text-[11px] leading-none">{icon()}</span>
    </Show>
  );
}

export function FileSidebar() {
  const [query, setQuery] = createSignal("");
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
    // The Figma stroke is an overlay on a non-scrolling wrapper: an outline on the scroller is painted under its sticky header.
    <nav
      id="files"
      aria-label="Files"
      hidden={repo.filesHidden}
      class="relative w-80 shrink-0 bg-side after:pointer-events-none after:absolute after:inset-0 after:z-[2] after:border-[.5px] after:border-line"
    >
      <div ref={nav} class="h-full overflow-auto pb-6">
        <div class="relative h-9 px-4 pt-2">
          <button
            class="-ml-1 grid h-[21px] w-7 cursor-pointer items-start justify-items-center rounded-lg bg-rule shadow-figma"
            title="Hide files"
            aria-label="Hide files"
            onClick={toggleFiles}
          >
            <SidebarIcon />
          </button>
          <Show when={repo.repo?.permissions?.push}>
            <button
              class="absolute top-[9px] left-[233px] size-5 cursor-pointer rounded hover:bg-hover"
              title="New file"
              aria-label="New file"
              aria-expanded={adding()}
              onClick={() => (setError(""), setAdding((a) => !a))}
            >
              <NewDocIcon />
            </button>
          </Show>
        </div>
        <div class="sticky top-0 z-[1] flex items-center gap-3 bg-side px-4 py-3">
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
          <form class="px-4 pb-3" onSubmit={submit}>
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
        <div class="-mt-px" hidden={!!query().trim()} onKeyDown={moveFocus}>
          <DirView dir={tree()} prefix="" depth={0} />
        </div>
        <div class="-mt-px" hidden={!query().trim()} onKeyDown={moveFocus}>
          <Show when={matches().length} fallback={<p class="px-4 py-3 text-muted">No files match.</p>}>
            <For each={matches()}>
              {(p) => (
                <a class="mx-1 mb-1.5 flex min-h-[25px] items-center gap-2 rounded py-[5px] pr-3 pl-3 hover:shadow-[inset_0_0_0_.5px_var(--line),var(--shadow)]" href={href(p)}>
                  <DocIcon path={p} />
                  <span>{p}</span>
                </a>
              )}
            </For>
          </Show>
        </div>
      </div>
    </nav>
  );
}

function DirView(props: { dir: Dir; prefix: string; depth: number }) {
  return (
    <>
      <For each={Object.keys(props.dir.dirs).sort(byName)}>
        {(name) => {
          const dir = `${props.prefix}${name}/`;
          return (
            <details open={repo.path.startsWith(dir)}>
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
