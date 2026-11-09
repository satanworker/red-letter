// The left sidebar while a pull request is under review (pulls.reviewing): instead of the branch's files, the PR's
// changed docs with how much each changed, the open one marked; clicking one opens it on the PR's branch with the
// changes against the base highlighted in the text (insertions lit, deletions as struck-out marks where they were:
// the prose kind of diff, not a line-based one). Then the threads left to settle and the review's actions.
import { For, Show, createMemo } from "solid-js";
import { comments } from "../comments/commentsStore.ts";
import { blobUrl } from "../repo/repoService.ts";
import type { PrLink } from "../repo/pulls.ts";
import { endReview, repo } from "../repo/repoStore.ts";
import { CloseIcon, FileIcon, ago, badge } from "../ui.tsx";
import { pulls } from "./pullsStore.ts";
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
  const mark = () => {
    const p = pr();
    if (!p) return "";
    return p.draft ? "draft" : p.decision === "APPROVED" ? "approved" : p.decision === "CHANGES_REQUESTED" ? "changes requested" : "";
  };
  const openHere = () => comments.prThreads.filter((t) => t.pr.number === rv().number && !t.resolved).length;
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
      <div class="px-3 pb-1 text-muted">{pr()?.review ? "Commented docs" : "Changed docs"}</div>
      <div class="min-h-0 flex-1 overflow-auto">
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
          <ReviewActions pr={link()} docs={docs().map((d) => d.path)} openThreads={pr()?.open ?? openHere()} />
          <a class="ml-auto text-muted hover:text-fg" href={link().url} target="_blank" rel="noopener">
            GitHub ↗
          </a>
        </div>
      </div>
    </div>
  );
}
