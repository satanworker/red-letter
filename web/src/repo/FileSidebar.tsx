// Collapsible tree of the branch's markdown files; folders on the current file's path are open.
// Links are plain <a href>: main.tsx's navigate handler turns them into in-page file switches.
import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import { FileIcon, FolderIcon } from "../ui.tsx";
import { blobUrl } from "./repoService.ts";
import { selectMatches, selectTree, type Dir } from "./repoSelectors.ts";
import { repo } from "./repoStore.ts";

const href = (path: string) => blobUrl(repo.repo!.full_name, repo.branch, path);
const indent = (depth: number) => ({ "padding-left": `${8 + depth * 14}px` });
const byName = (a: string, b: string) => a.localeCompare(b);

export function FileSidebar() {
  const [query, setQuery] = createSignal("");
  const tree = createMemo(() => selectTree(repo.docs));
  const matches = createMemo(() => selectMatches(repo.docs, query()));
  let nav!: HTMLElement;
  onMount(() => nav.querySelector(".file.on")?.scrollIntoView({ block: "center" }));
  return (
    <nav id="files" ref={nav} hidden={repo.filesHidden}>
      <div class="files-head">
        <input type="search" placeholder="Find a file…" onInput={(e) => setQuery(e.currentTarget.value)} />
        <span class="meta">{repo.docs.length} docs</span>
      </div>
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
