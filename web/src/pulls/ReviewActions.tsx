// What a reviewer does with a pull request, GitHub's way: Approve, Request changes (with a note) and Merge; a review
// PR (our comments-only branch) is closed once its threads are settled, nothing to merge. On the PR's own branch
// only: that's where doc.pr (state, mergeable) is known. Elsewhere: Review, which goes there.
import { Show } from "solid-js";
import { doc } from "../doc/docStore.ts";
import { isReviewBranch, type PrLink } from "../repo/pulls.ts";
import { approvePullRequest, closePullRequest, mergePullRequest, repo, requestChangesOnPullRequest, reviewPullRequest } from "../repo/repoStore.ts";
import { btn } from "../ui.tsx";

const disabled = "disabled:cursor-default disabled:opacity-50";

export function ReviewActions(props: { pr: PrLink; docs: string[]; openThreads: number }) {
  const here = () => props.pr.head === repo.branch;
  const review = () => isReviewBranch(props.pr.head);
  const requestChanges = () => {
    const note = prompt("What should change?");
    if (note) void requestChangesOnPullRequest(props.pr.number, note);
  };
  const close = () => {
    const warn = props.openThreads ? ` ${props.openThreads} thread${props.openThreads === 1 ? " is" : "s are"} still open.` : "";
    if (confirm(`Close pull request #${props.pr.number}${review() ? " and end this review" : ""}?${warn} Nothing is merged.`)) void closePullRequest(props.pr);
  };
  return (
    <Show
      when={here()}
      fallback={
        <button
          class={btn}
          title={review() ? "Open the doc with the review's threads" : `Open the doc on ${props.pr.head} with its changes highlighted`}
          onClick={() => reviewPullRequest(props.pr, props.docs)}
        >
          Review
        </button>
      }
    >
      <Show when={doc.pr && doc.pr.author !== repo.user?.login}>
        <button class={`${btn} ${disabled}`} disabled={!!doc.drafting} onClick={() => void approvePullRequest()}>
          Approve
        </button>
        <button class={`${btn} ${disabled}`} disabled={!!doc.drafting} onClick={requestChanges}>
          Request changes
        </button>
      </Show>
      <Show
        when={!review()}
        fallback={
          <button class={`${btn} ${disabled}`} disabled={!!doc.drafting} title="Close the review: its threads are settled, or it's over. Nothing is merged." onClick={close}>
            {doc.drafting || "Close review"}
          </button>
        }
      >
        <button
          class={`${btn} ${disabled}`}
          disabled={!!doc.drafting || !doc.pr || doc.pr.mergeable === false}
          title={`Merge the pull request into ${props.pr.base} and delete this branch`}
          onClick={() => void mergePullRequest()}
        >
          {doc.drafting || "Merge"}
        </button>
      </Show>
    </Show>
  );
}
