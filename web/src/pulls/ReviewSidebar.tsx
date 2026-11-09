// The left sidebar while a pull request is under review (pulls.reviewing): instead of the branch's files, the PR's
// changed docs with how much each changed, the open one marked; clicking one opens it on the PR's branch with the
// changes against the base highlighted in the text (insertions lit, deletions as struck-out marks where they were:
// the prose kind of diff, not a line-based one). Then the threads left to settle and the review's actions.
import { For, Show, createMemo } from "solid-js";
import { splitPrMark } from "../comments/commentsSelectors.ts";
import { openThread } from "../doc/docStore.ts";
import { blobUrl } from "../repo/repoService.ts";
import type { PrLink, PrThread } from "../repo/pulls.ts";
import { endReview, navigateTo, repo } from "../repo/repoStore.ts";
import { CloseIcon, FileIcon, ago, badge } from "../ui.tsx";
import { pulls, setFocusThread } from "./pullsStore.ts";
import { ReviewActions } from "./ReviewActions.tsx";

export function ReviewSidebar() {
  const rv = () => pulls.reviewing!;
  const pr = createMemo(() => pulls.list.find((p) => p.number === rv().number));
  const link = (): PrLink =>
    pr() ?? {
      number: rv().number,
      url: `https://github.com/${repo.repo!.full_name}/pull/${rv().number}`,
      title: `#${rv().number}`,
      head: rv().head,
      base: rv().base,
    };
  const docs = () => pr()?.docs ?? [];
  // the PR's threads by file, in the order the changed docs are listed, then the rest
  const byFile = createMemo((): [string, PrThread[]][] => {
    const groups = new Map<string, PrThread[]>();
    for (const t of pr()?.threads ?? []) groups.set(t.path, [...(groups.get(t.path) ?? []), t]);
    return [...groups].sort(([a], [b]) => docs().findIndex((d) => d.path === a) - docs().findIndex((d) => d.path === b));
  });
  // a thread's doc on the PR's branch, with the thread lit: at once if it's the open doc, else once it has opened
  const openThreadIn = (path: string, id: string) => {
    if (path === repo.path && repo.branch === rv().head) return openThread(id);
    setFocusThread(id);
    navigateTo(blobUrl(repo.repo!.full_name, rv().head, path));
  };
  const mark = () => {
    const p = pr();
    if (!p) return "";
    return p.draft ? "draft" : p.decision === "APPROVED" ? "approved" : p.decision === "CHANGES_REQUESTED" ? "changes requested" : "";
  };
  const openCount = () => pr()?.open ?? 0;
  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="flex items-start gap-2 px-3 pt-3 pb-2">
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline gap-2">
            <span class="text-muted">Reviewing #{rv().number}</span>
            <Show when={mark()}>
              <span class={`${badge} px-1.5`}>{mark()}</span>
            </Show>
          </div>
          <div class="truncate" title={pr()?.title}>
            {pr()?.review ? `Review of ${docs()[0]?.path.split("/").pop() ?? "a doc"}` : (pr()?.title ?? "")}
          </div>
          <Show when={pr()}>
            {(p) => (
              <div class="truncate text-muted" title={`${p().head} → ${p().base}`}>
                {p().author} · {ago(p().updatedAt)} · {p().review ? "review" : p().head} → {p().base}
              </div>
            )}
          </Show>
        </div>
        <button class="mt-0.5 shrink-0 cursor-pointer rounded hover:bg-hover" title="Done reviewing: back to the files" aria-label="Done reviewing" onClick={endReview}>
          <CloseIcon />
        </button>
      </div>
      <div class="min-h-0 flex-1 overflow-auto">
        <div class="px-3 pb-1 text-muted">{pr()?.review ? "Commented docs" : "Changed docs"}</div>
        <Show when={docs().length} fallback={<p class="px-3 py-2 text-muted">{pr() ? "No markdown files changed." : "Loading…"}</p>}>
          <For each={docs()}>
            {(d) => (
              <a
                class="mx-1 mb-[7px] flex h-[25px] items-center gap-1 rounded pr-3 pl-2 whitespace-nowrap hover:shadow-[inset_0_0_0_.5px_var(--line),var(--shadow)] aria-[current=page]:bg-on"
                href={blobUrl(repo.repo!.full_name, rv().head, d.path)}
                aria-current={d.path === repo.path && repo.branch === rv().head ? "page" : undefined}
                title={d.path}
              >
                <FileIcon />
                <span class="min-w-0 flex-1 truncate">{d.path}</span>
                <Show when={!pr()?.review && d.additions + d.deletions}>
                  <span class="shrink-0 text-muted">
                    <span class="text-green">+{d.additions}</span> <span class="text-del">−{d.deletions}</span>
                  </span>
                </Show>
              </a>
            )}
          </For>
        </Show>
        {/* every comment thread on the PR, whatever file it's on; a click opens that file on the PR's branch with the thread lit */}
        <Show when={pr()?.threads.length}>
          <div class="mt-3 px-3 pb-1 text-muted">Comments</div>
          <For each={byFile()}>
            {([path, threads]) => (
              <div class="mb-2">
                <div class="truncate px-3 text-muted" title={path}>
                  {path.split("/").pop()}
                </div>
                <For each={threads}>
                  {(t) => (
                    <button
                      class={`mx-1 flex w-[calc(100%-8px)] cursor-pointer items-baseline gap-1.5 rounded px-2 py-0.5 text-left hover:bg-hover ${t.resolved ? "text-muted" : ""}`}
                      title={splitPrMark(t.comments[0]?.body ?? "").body}
                      onClick={() => openThreadIn(path, t.id)}
                    >
                      <span class={`size-[7px] shrink-0 translate-y-[-1px] rounded-full ${t.resolved ? "border border-line" : "bg-yellow"}`} />
                      <span class="shrink-0">{t.comments[0]?.author}</span>
                      <span class="min-w-0 flex-1 truncate">{splitPrMark(t.comments[0]?.body ?? "").body.split("\n")[0]}</span>
                      <Show when={t.comments.length > 1}>
                        <span class="shrink-0 text-muted">{t.comments.length}</span>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            )}
          </For>
        </Show>
      </div>
      <div class="flex flex-col gap-2 border-t-[.5px] border-line px-3 py-3">
        <Show when={pr()}>
          {(p) => (
            <span class={p().open ? "text-fg" : "text-muted"}>
              {p().open ? `${p().open} open thread${p().open === 1 ? "" : "s"}` : p().resolved ? "All threads settled" : "No comments yet"}
              <Show when={p().resolved && p().open}> · {p().resolved} resolved</Show>
            </span>
          )}
        </Show>
        <div class="flex flex-wrap items-center gap-2">
          <ReviewActions pr={link()} docs={docs().map((d) => d.path)} openThreads={openCount()} />
          <a class="ml-auto text-muted hover:text-fg" href={link().url} target="_blank" rel="noopener">
            GitHub ↗
          </a>
        </div>
      </div>
    </div>
  );
}
