// The header's pull requests button: every open PR the doc takes part in (from its branch, and into it: reviews of
// it), as a native popover like the page menu. The PR from this branch carries its review state and Approve / Merge;
// the others open their branch's doc here. With none, the button opens one from this branch.
import { For, Show } from "solid-js";
import { comments } from "../comments/commentsStore.ts";
import { blobUrl } from "../repo/repoService.ts";
import { approvePullRequest, mergePullRequest, navigateTo, openPullRequest, prTitle, repo } from "../repo/repoStore.ts";
import { badge, btn, linkBtn } from "../ui.tsx";
import { doc } from "./docStore.ts";

export function PullRequests() {
  let menu!: HTMLDivElement;
  const canWrite = () => repo.repo?.permissions?.push === true;
  const n = () => comments.prs.length;
  // under the button, left edges aligned
  const place = (b: HTMLElement) => {
    const r = b.getBoundingClientRect();
    Object.assign(menu.style, { top: `${r.bottom + 6}px`, left: `${r.left}px` });
  };
  const askPr = () => {
    const title = prompt("Pull request title", prTitle(repo.branch));
    if (title) void openPullRequest(title);
  };
  const state = () => {
    const pr = doc.pr;
    if (!pr) return "";
    if (pr.mergeable === false) return `not mergeable: update from ${pr.base}`;
    if (pr.changesRequested.length) return `changes requested by ${pr.changesRequested.join(", ")}`;
    if (pr.approved.length) return `approved by ${pr.approved.join(", ")}`;
    return "";
  };
  return (
    <>
      <button class={`ml-2 ${badge} cursor-pointer px-1.5`} popoverTarget="pull-requests" title="Pull requests this doc takes part in" onClick={(e) => place(e.currentTarget)}>
        {n() ? `${n()} pull request${n() === 1 ? "" : "s"}` : "Pull requests"}
      </button>
      <div
        ref={menu}
        id="pull-requests"
        popover
        class="fixed inset-auto m-0 w-[420px] flex-col gap-4 rounded-xl bg-card px-5 py-5 text-fg shadow-[0_4px_17.8px_rgba(0,0,0,.1),var(--shadow)] [&:popover-open]:flex"
      >
        <Show when={!n()}>
          <p class="text-muted">No open pull request touches this doc. {canWrite() ? "The first comment opens one: a review of this doc, shared by everyone, back into this branch." : ""}</p>
        </Show>
        <For each={comments.prs}>
          {(pr) => {
            const mine = () => pr.head === repo.branch;
            return (
              <div class="flex flex-col gap-1.5">
                <div class="flex items-baseline gap-2">
                  <a class="shrink-0 text-muted hover:underline" href={pr.url} target="_blank" rel="noopener">
                    #{pr.number}
                  </a>
                  <span class="min-w-0 flex-1 truncate" title={pr.title}>
                    {pr.title}
                  </span>
                  <Show when={mine() && state()}>
                    <span class={`${badge} max-w-[160px] shrink-0 truncate px-1.5`} title={state()}>
                      {state()}
                    </span>
                  </Show>
                </div>
                <div class="truncate text-muted" title={`${pr.head} → ${pr.base}`}>
                  {pr.head} → {pr.base}
                </div>
                <div class="flex items-center gap-2">
                  <Show
                    when={mine()}
                    fallback={
                      <button
                        class={btn}
                        onClick={() => {
                          menu.hidePopover();
                          navigateTo(blobUrl(repo.repo!.full_name, pr.head, repo.path));
                        }}
                      >
                        Open
                      </button>
                    }
                  >
                    <Show when={doc.pr && doc.pr.author !== repo.user?.login}>
                      <button class={`${btn} disabled:cursor-default disabled:opacity-50`} disabled={!!doc.drafting} onClick={() => void approvePullRequest()}>
                        Approve
                      </button>
                    </Show>
                    <button
                      class={`${btn} disabled:cursor-default disabled:opacity-50`}
                      disabled={!!doc.drafting || !doc.pr || doc.pr.mergeable === false}
                      title={`Merge the pull request into ${pr.base} and delete this branch`}
                      onClick={() => {
                        menu.hidePopover();
                        void mergePullRequest();
                      }}
                    >
                      {doc.drafting || "Merge"}
                    </button>
                  </Show>
                  <a class={`${linkBtn} ml-auto`} href={pr.url} target="_blank" rel="noopener">
                    GitHub ↗
                  </a>
                </div>
              </div>
            );
          }}
        </For>
        <Show when={canWrite() && repo.repo && repo.branch !== repo.repo.default_branch && !comments.prs.some((p) => p.head === repo.branch)}>
          <button
            class={`${linkBtn} self-start`}
            onClick={() => {
              menu.hidePopover();
              askPr();
            }}
          >
            Open a pull request from {repo.branch}
          </button>
        </Show>
      </div>
    </>
  );
}
