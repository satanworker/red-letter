// A pull request's description, shown in place of the doc when the PR is picked in the tree (VS Code's PR overview):
// title, who and where, the description, the comments on the PR itself (not on a file: those sit with their files in
// the tree and in the doc's margin), a box to add one, and the review actions.
import { For, Show, createSignal } from "solid-js";
import { Message } from "../comments/CommentsPanel.tsx";
import { prHead, prMark, prTitle, type RepoPr } from "../repo/pulls.ts";
import { ago, badge, btn, card } from "../ui.tsx";
import { pulls, commentOnPullRequest } from "./pullsStore.ts";
import { ReviewActions } from "./ReviewActions.tsx";

const REVIEW: Record<string, string> = { APPROVED: "approved", CHANGES_REQUESTED: "requested changes", COMMENTED: "reviewed", DISMISSED: "review dismissed" };

export function PrOverview(props: { pr: RepoPr }) {
  const [text, setText] = createSignal("");
  const send = async (e: SubmitEvent) => {
    e.preventDefault();
    if (await commentOnPullRequest(props.pr.number, text())) setText("");
  };
  return (
    <div class="mx-auto flex max-w-[720px] flex-col gap-5 px-8 py-10">
      <div class="flex flex-col gap-1.5">
        <h1 class="text-[22px] font-semibold">
          {prTitle(props.pr)} <span class="font-normal text-muted">#{props.pr.number}</span>
        </h1>
        <p class="text-muted">
          by {props.pr.author} · {ago(props.pr.updatedAt)} · {prHead(props.pr)} → {props.pr.base}
          <Show when={prMark(props.pr)}> · <span class={`${badge} px-1`}>{prMark(props.pr)}</span></Show>
        </p>
      </div>
      <div class={`${card} gap-3`}>
        <Show when={props.pr.body.trim()} fallback={<p class="text-muted italic">No description.</p>}>
          <div class="break-words whitespace-pre-wrap">{props.pr.body}</div>
        </Show>
      </div>
      <For each={props.pr.conversation}>
        {(c) => (
          <div class={`${card} gap-2`}>
            <Show when={c.review && REVIEW[c.review]}>{(r) => <span class={`${badge} self-start px-1.5`}>{r()}</span>}</Show>
            <Message m={c} />
          </div>
        )}
      </For>
      <form class="flex flex-col gap-2" onSubmit={send}>
        <textarea
          aria-label="Comment on the pull request"
          placeholder="Comment on the pull request"
          rows={3}
          class="w-full rounded-lg border-[.4px] border-line bg-card px-3 py-2 outline-none placeholder:text-muted"
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && e.currentTarget.form?.requestSubmit()}
        />
        <Show when={pulls.postError}>
          <p class="text-red [overflow-wrap:anywhere]">{pulls.postError}</p>
        </Show>
        <div>
          <button class={`${btn} disabled:cursor-default disabled:opacity-50`} disabled={pulls.posting || !text().trim()}>
            {pulls.posting ? "Commenting…" : "Comment"}
          </button>
        </div>
      </form>
      {/* outside the form: these buttons would submit it */}
      <div class="flex flex-wrap items-center gap-2 border-t-[.4px] border-rule pt-4">
        <ReviewActions pr={props.pr} docs={props.pr.docs.map((d) => d.path)} openThreads={props.pr.open} />
        <a class="ml-auto text-muted hover:text-fg" href={props.pr.url} target="_blank" rel="noopener">
          GitHub ↗
        </a>
      </div>
    </div>
  );
}
