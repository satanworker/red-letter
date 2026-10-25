// Collapsible tree of the branch's markdown files; folders on the current file's path are open.
// Links are plain <a href>: main.tsx's navigate handler turns them into in-page file switches.
import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import { ArrowDownIcon, ArrowUpIcon, FileIcon, FolderIcon, NewDocIcon, SearchIcon, SidebarIcon } from "../ui.tsx";
import { blobUrl } from "./repoService.ts";
import { selectMatches, selectTree, type Dir } from "./repoSelectors.ts";
import { createFile, repo, toggleFiles } from "./repoStore.ts";

const href = (path: string) => blobUrl(repo.repo!.full_name, repo.branch, path);
const indent = (depth: number) => ({ "padding-left": `${12 + depth * 20}px` });
const byName = (a: string, b: string) => a.localeCompare(b);

export function FileSidebar() {
  const [query, setQuery] = createSignal("");
  const [adding, setAdding] = createSignal(false);
  const [error, setError] = createSignal("");
  const tree = createMemo(() => selectTree(repo.docs));
  const matches = createMemo(() => selectMatches(repo.docs, query()));
  // the open file's folder, so "+" in docs/research/x.md suggests docs/research/
  const folder = () => repo.path.split("/").slice(0, -1).map((s) => `${s}/`).join("");
  let nav!: HTMLElement;
  onMount(() => nav.querySelector(".file.on")?.scrollIntoView({ block: "center" }));
  const submit = (e: SubmitEvent & { currentTarget: HTMLFormElement }) => {
    e.preventDefault();
    const err = createFile(new FormData(e.currentTarget).get("path")?.toString() ?? "");
    setError(err ?? "");
    if (!err) setAdding(false);
  };
  return (
    <nav id="files" ref={nav} hidden={repo.filesHidden}>
      <div class="files-bar">
        <button class="toggle" title="Hide files" onClick={toggleFiles}>
          <SidebarIcon />
        </button>
        <Show when={repo.repo?.permissions?.push}>
          <button class="btn ghost icon" title="New file" onClick={() => (setError(""), setAdding((a) => !a))}>
            <NewDocIcon />
          </button>
        </Show>
      </div>
      <div class="files-head">
        <label class="search">
          <SearchIcon />
          <input type="search" placeholder="Find a file" onInput={(e) => setQuery(e.currentTarget.value)} />
        </label>
        <span class="meta">{repo.docs.length} docs</span>
      </div>
      <Show when={adding()}>
        <form class="new-file" onSubmit={submit}>
          <input
            name="path"
            value={folder()}
            placeholder="folder/name.md"
            spellcheck={false}
            ref={(el) => requestAnimationFrame(() => (el.focus(), el.setSelectionRange(el.value.length, el.value.length)))}
            onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
          />
          <p class="fine">{error() || "Enter to create · Esc to cancel"}</p>
        </form>
      </Show>
      <div class="tree" hidden={!!query().trim()}>
        <DirView dir={tree()} prefix="" depth={0} />
      </div>
      <div class="flat" hidden={!query().trim()}>
        <Show when={matches().length} fallback={<p class="empty">No files match.</p>}>
          <For each={matches()}>
            {(p) => (
              <a class="file" href={href(p)}>
                <FileIcon />
                <span>{p}</span>
              </a>
            )}
          </For>
        </Show>
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
              <summary style={indent(props.depth)}>
                <FolderIcon />
                <span>{name}</span>
                <ArrowUpIcon class="open" />
                <ArrowDownIcon class="closed" />
              </summary>
              <DirView dir={props.dir.dirs[name]} prefix={dir} depth={props.depth + 1} />
            </details>
          );
        }}
      </For>
      <For each={props.dir.files.slice().sort(byName)}>
        {(p) => (
          <a class="file" classList={{ on: p === repo.path }} href={href(p)} style={indent(props.depth)}>
            <FileIcon />
            <span>{p.split("/").pop()}</span>
          </a>
        )}
      </For>
    </>
  );
}
