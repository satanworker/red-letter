// The left sidebar's Pull requests view, after VS Code's GitHub Pull Requests tree: the repo's open PRs (title, author,
// number, state). A click opens the PR's description in a tab of its own (PrOverview) and unfolds it into the files it
// changes as a folder tree with M / A / D / R, line counts and how many comments each file has, then the comments on
// the PR itself. A markdown file opens on the PR's branch with the PR's changes against its base lit in the text
// (review mode); other files link to GitHub. Keyboard: Up/Down/Home/End move between the rows showing.
import { For, Show, createEffect, createMemo } from "solid-js";
import { isDoc, prHead, prMark, prTitle, type PrDoc, type RepoPr } from "../repo/pulls.ts";
import { repo, reviewPullRequest, showPullRequest } from "../repo/repoStore.ts";
import { ArrowDownIcon, ArrowUpIcon, Avatar, CommentIcon, FileIcon, FolderIcon, ago, badge, listKeys } from "../ui.tsx";
import { pulls, togglePr } from "./pullsStore.ts";

// Figma sidebar rows, as the file tree's
const row = "mx-1 flex h-[25px] items-center gap-1 whitespace-nowrap rounded pr-2 hover:shadow-[inset_0_0_0_.5px_var(--line),var(--shadow)]";
const indent = (depth: number) => ({ "padding-left": `${8 + depth * 16}px` });
const STATUS: Record<PrDoc["changeType"], [string, string]> = {
  ADDED: ["A", "text-green"],
  MODIFIED: ["M", "text-[#b08800]"],
  CHANGED: ["M", "text-[#b08800]"],
  DELETED: ["D", "text-del"],
  RENAMED: ["R", "text-blue"],
  COPIED: ["C", "text-blue"],
};

export function PullsTree() {
  return (
    // rows: the PRs (role=button, holding the fold button), folders, files, comments
    <div class="min-h-0 flex-1 overflow-auto pt-1" onKeyDown={(e) => listKeys(e, ':is([role="button"], summary, a, button):not([role="button"] *)')}>
      <Show when={pulls.error}>
        <p class="px-3 py-2 text-red [overflow-wrap:anywhere]">{pulls.error}</p>
      </Show>
      <Show when={pulls.list.length} fallback={<p class="px-3 py-2 text-muted">{pulls.loaded ? "No open pull requests." : "Loading…"}</p>}>
        <For each={pulls.list}>{(pr) => <PrNode pr={pr} />}</For>
      </Show>
    </div>
  );
}

type Tree = { dirs: Map<string, Tree>; files: PrDoc[] };
function tree(files: PrDoc[]): Tree {
  const root: Tree = { dirs: new Map(), files: [] };
  for (const f of files) {
    let d = root;
    const parts = f.path.split("/");
    for (const p of parts.slice(0, -1)) d = d.dirs.get(p) ?? (d.dirs.set(p, { dirs: new Map(), files: [] }), d.dirs.get(p)!);
    d.files.push(f);
  }
  return root;
}
// VS Code's compact folders: a folder holding only one folder shows as "a/b"
function compact(name: string, d: Tree): [string, Tree] {
  while (!d.files.length && d.dirs.size === 1) {
    const [n, sub] = [...d.dirs][0]!;
    name = `${name}/${n}`;
    d = sub;
  }
  return [name, d];
}

const unfolded = new Set<string>();
function PrNode(props: { pr: RepoPr }) {
  const open = () => pulls.open.includes(props.pr.number);
  // the PR whose branch is open (VS Code's checked-out PR): marked, unfolded the first time it's seen here, and the
  // open doc reviewed against its base (its changes lit) when no review is under way
  const here = () => props.pr.head === repo.branch;
  createEffect(() => {
    const k = `${props.pr.number}@${repo.branch}`;
    if (here() && !unfolded.has(k)) {
      unfolded.add(k);
      if (!open()) togglePr(props.pr.number);
      if (!pulls.reviewing && props.pr.files.some((f) => f.path === repo.path)) reviewPullRequest(props.pr, [], repo.path);
    }
  });
  const reviewing = () => pulls.reviewing?.number === props.pr.number || here();
  const shown = () => repo.pull === props.pr.number;
  const files = createMemo(() => tree(props.pr.files));
  return (
    <div class="mb-1">
      <div
        role="button"
        tabindex="0"
        class={`${row} w-[calc(100%-8px)] cursor-pointer gap-1.5 pl-2 text-left ${shown() ? "bg-on shadow-figma" : reviewing() ? "bg-on" : ""}`}
        aria-expanded={open()}
        title={`#${props.pr.number} ${props.pr.title}\n${props.pr.head} → ${props.pr.base}`}
        onClick={() => showPullRequest(props.pr.number)}
        onKeyDown={(e) => e.key === "Enter" && showPullRequest(props.pr.number)}
      >
        {/* the chevron only folds; the row shows the description */}
        <button
          class="-ml-1 w-4 shrink-0 cursor-pointer text-muted hover:text-fg"
          aria-label={open() ? "Fold" : "Unfold"}
          onClick={(e) => (e.stopPropagation(), togglePr(props.pr.number))}
        >
          {open() ? "▾" : "▸"}
        </button>
        <Avatar login={props.pr.author} size={16} />
        <span class={`min-w-0 flex-1 truncate ${props.pr.draft ? "italic" : ""}`}>{prTitle(props.pr)}</span>
        <Show when={props.pr.open}>
          <span class="shrink-0 rounded-full bg-yellow-bg px-1.5 text-[11px]" title={`${props.pr.open} open thread${props.pr.open === 1 ? "" : "s"}`}>
            {props.pr.open}
          </span>
        </Show>
        <span class="shrink-0 text-muted">#{props.pr.number}</span>
      </div>
      <Show when={open()}>
        <div class="mb-2">
          <div class="truncate pr-3 text-muted" style={indent(1)} title={`${props.pr.head} → ${props.pr.base}`}>
            by {props.pr.author} · {ago(props.pr.updatedAt)} · {prHead(props.pr)} → {props.pr.base}
            <Show when={prMark(props.pr)}> · <span class={`${badge} px-1`}>{prMark(props.pr)}</span></Show>
          </div>
          <Show when={props.pr.files.length} fallback={<p class="text-muted" style={indent(1)}>No files changed.</p>}>
            <Dir dir={files()} pr={props.pr} depth={1} />
          </Show>
          <Conversation pr={props.pr} />
        </div>
      </Show>
    </div>
  );
}

function Dir(props: { dir: Tree; pr: RepoPr; depth: number }) {
  return (
    <>
      <For each={[...props.dir.dirs].sort(([a], [b]) => a.localeCompare(b))}>
        {([name, sub]) => {
          const [label, d] = compact(name, sub);
          return (
            <details open>
              <summary class={`${row} cursor-pointer list-none`} style={indent(props.depth)}>
                <FolderIcon />
                <span class="truncate">{label}</span>
                <ArrowUpIcon />
                <ArrowDownIcon />
              </summary>
              <Dir dir={d} pr={props.pr} depth={props.depth + 1} />
            </details>
          );
        }}
      </For>
      <For each={props.dir.files.slice().sort((a, b) => a.path.localeCompare(b.path))}>{(f) => <File f={f} pr={props.pr} depth={props.depth} />}</For>
    </>
  );
}

function File(props: { f: PrDoc; pr: RepoPr; depth: number }) {
  const [letter, color] = STATUS[props.f.changeType] ?? ["M", "text-muted"];
  const doc = () => isDoc(props.f.path) && props.f.changeType !== "DELETED";
  const here = () => (pulls.reviewing?.number === props.pr.number || props.pr.head === repo.branch) && repo.path === props.f.path && !repo.pull;
  const threads = createMemo(() => props.pr.threads.filter((t) => t.path === props.f.path));
  const said = () => threads().reduce((n, t) => n + t.comments.length, 0);
  const body = () => (
    <>
      <FileIcon />
      <span class={`min-w-0 flex-1 truncate ${color}`}>{props.f.path.split("/").pop()}</span>
      <Show when={said()}>
        <span
          class={`inline-flex shrink-0 items-center gap-0.5 text-[11px] ${threads().some((t) => !t.resolved) ? "" : "text-muted opacity-60"}`}
          title={`${said()} comment${said() === 1 ? "" : "s"} in ${threads().length} thread${threads().length === 1 ? "" : "s"}, ${threads().filter((t) => !t.resolved).length} open`}
        >
          <span class="scale-75">
            <CommentIcon />
          </span>
          {said()}
        </span>
      </Show>
      <Show when={!props.pr.review && props.f.additions + props.f.deletions}>
        <span class="shrink-0 text-[11px] text-muted">
          <span class="text-green">+{props.f.additions}</span> <span class="text-del">−{props.f.deletions}</span>
        </span>
      </Show>
      <span class={`w-3 shrink-0 text-right font-medium ${color}`}>{letter}</span>
    </>
  );
  return (
    <Show
      when={doc()}
      fallback={
        <a class={`${row} opacity-70`} style={indent(props.depth)} href={`${props.pr.url}/files`} target="_blank" rel="noopener" title={`${props.f.path}: opens on GitHub`}>
          {body()}
        </a>
      }
    >
      <button
        class={`${row} w-[calc(100%-8px)] cursor-pointer text-left ${here() ? "bg-on shadow-figma" : ""}`}
        style={indent(props.depth)}
        title={props.f.path}
        aria-current={here() ? "page" : undefined}
        onClick={() => reviewPullRequest(props.pr, [props.f.path], props.f.path)}
      >
        {body()}
      </button>
    </Show>
  );
}

// The comments on the PR itself (its conversation and the reviews' notes), not on a file; a click shows the description
function Conversation(props: { pr: RepoPr }) {
  return (
    <Show when={props.pr.conversation.length}>
      <div class="mt-2 text-muted" style={indent(1)}>
        Comments
      </div>
      <For each={props.pr.conversation}>
        {(c) => (
          <button
            class={`${row} w-[calc(100%-8px)] cursor-pointer gap-1.5 text-left`}
            style={indent(2)}
            title={`${c.author}, ${ago(c.at)}\n${c.body}`}
            onClick={() => showPullRequest(props.pr.number)}
          >
            <Avatar login={c.author} size={14} />
            <span class="shrink-0">{c.author}</span>
            <span class="min-w-0 flex-1 truncate text-muted">{c.body.split("\n")[0]}</span>
          </button>
        )}
      </For>
    </Show>
  );
}
