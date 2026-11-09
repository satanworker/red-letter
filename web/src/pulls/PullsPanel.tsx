// The side panel's PRs tab, laid out like VS Code's GitHub Pull Requests view: "This doc" (the open PRs this doc
// takes part in), then the repo's open PRs grouped as Waiting for my review, Created by me and All open. Every row
// says what a reviewer needs: what's open to settle, what changed, what state the review is in, and what to do next:
// Review opens the PR's doc on its branch with the changes against the base highlighted; Approve, Request changes and
// Merge are GitHub's; a review PR (our comments-only branch) is closed when its threads are settled, not merged.
import { For, Show, createMemo } from "solid-js";
import { comments } from "../comments/commentsStore.ts";
import { doc } from "../doc/docStore.ts";
import { blobUrl } from "../repo/repoService.ts";
import { isReviewBranch, type PrLink, type RepoPr } from "../repo/pulls.ts";
import { openPullRequest, prTitle, repo, reviewPullRequest } from "../repo/repoStore.ts";
import { ArrowDownIcon, ArrowUpIcon, ago, badge, btn, linkBtn } from "../ui.tsx";
import { pulls } from "./pullsStore.ts";
import { ReviewActions } from "./ReviewActions.tsx";

const section = "mb-1.5 px-0.5 text-muted";
const disabled = "disabled:cursor-default disabled:opacity-50";
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function PullsPanel() {
  const me = () => repo.user?.login ?? "";
  const waiting = createMemo(() => pulls.list.filter((p) => p.reviewers.includes(me())));
  const mine = createMemo(() => pulls.list.filter((p) => p.author === me()));
  const canWrite = () => repo.repo?.permissions?.push === true;
  const askPr = () => {
    const title = prompt("Pull request title", prTitle(repo.branch));
    if (title) void openPullRequest(title);
  };
  return (
    <div class="flex flex-col gap-5">
      <section>
        <h3 class={section}>This doc</h3>
        <Show
          when={comments.prs.length}
          fallback={
            <p class="px-0.5 text-muted">
              No open pull request touches this doc.
              {canWrite() ? " The first comment opens one." : ""}
            </p>
          }
        >
          <ul class="flex flex-col gap-3">
            <For each={comments.prs}>{(pr) => <DocPr pr={pr} />}</For>
          </ul>
        </Show>
        <Show when={canWrite() && doc.session?.doc.base && !comments.prs.some((p) => p.head === repo.branch)}>
          <button class={`${linkBtn} mt-2 px-0.5 ${disabled}`} disabled={!!doc.drafting} onClick={askPr}>
            {doc.drafting || `Open a pull request from ${repo.branch}`}
          </button>
        </Show>
      </section>
      <Show when={pulls.error}>
        <p class="px-0.5 text-red [overflow-wrap:anywhere]">{pulls.error}</p>
      </Show>
      <Group title="Waiting for my review" list={waiting()} />
      <Group title="Created by me" list={mine()} />
      <Group title="All open" list={pulls.list} empty={pulls.loaded ? "No open pull requests." : "Loading…"} />
    </div>
  );
}

// A PR this doc takes part in. Its threads on this doc (open / resolved), the PR's state, and the next step: on its
// branch, Approve / Request changes / Merge (a review PR: Close once settled); elsewhere, Review.
function DocPr(props: { pr: PrLink }) {
  const here = () => props.pr.head === repo.branch;
  const review = () => isReviewBranch(props.pr.head);
  const threads = createMemo(() => comments.prThreads.filter((t) => t.pr.number === props.pr.number));
  const open = () => threads().filter((t) => !t.resolved).length;
  const resolved = () => threads().length - open();
  const full = () => pulls.list.find((p) => p.number === props.pr.number);
  const state = () => {
    const pr = doc.pr;
    if (here() && pr) {
      if (pr.mergeable === false && !review()) return `not mergeable: update from ${pr.base}`;
      if (pr.changesRequested.length) return `changes requested by ${pr.changesRequested.join(", ")}`;
      if (pr.approved.length) return `approved by ${pr.approved.join(", ")}`;
      return "";
    }
    const d = full()?.decision;
    return d === "APPROVED" ? "approved" : d === "CHANGES_REQUESTED" ? "changes requested" : "";
  };
  return (
    <li class="flex flex-col gap-1.5 rounded-xl bg-card px-3 py-2.5 shadow-figma">
      <div class="flex items-baseline gap-2">
        <a class="shrink-0 text-muted hover:underline" href={props.pr.url} target="_blank" rel="noopener">
          #{props.pr.number}
        </a>
        <span class="min-w-0 flex-1 truncate" title={props.pr.title}>
          <Show when={!review()} fallback={<>Review{full() ? ` by ${full()!.author}` : ""}</>}>
            {props.pr.title}
          </Show>
        </span>
        <Show when={state()}>
          <span class={`${badge} max-w-[150px] shrink-0 truncate px-1.5`} title={state()}>
            {state()}
          </span>
        </Show>
      </div>
      <div class="truncate text-muted" title={review() ? `${props.pr.head} → ${props.pr.base}` : `${props.pr.head} → ${props.pr.base}`}>
        <Show when={!review()}>
          {props.pr.head} → {props.pr.base} ·{" "}
        </Show>
        <Show when={threads().length} fallback="no comments yet">
          <span class={open() ? "text-fg" : ""}>{plural(open(), "open thread")}</span>
          <Show when={resolved()}> · {resolved()} resolved</Show>
        </Show>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <ReviewActions pr={props.pr} docs={[repo.path]} openThreads={open()} />
        <a class={`${linkBtn} ml-auto`} href={props.pr.url} target="_blank" rel="noopener">
          GitHub ↗
        </a>
      </div>
    </li>
  );
}

function Group(props: { title: string; list: RepoPr[]; empty?: string }) {
  return (
    <Show when={props.list.length || props.empty}>
      <section>
        <h3 class={section}>{props.title}</h3>
        <Show when={props.list.length} fallback={<p class="px-0.5 text-muted">{props.empty}</p>}>
          <ul class="flex flex-col gap-1">
            <For each={props.list}>{(pr) => <PrRow pr={pr} />}</For>
          </ul>
        </Show>
      </section>
    </Show>
  );
}

// One PR of the repo. Folded: what it is (a review of a doc, or a titled change), its state, and what's left to
// settle. Open: who, when, the docs it changed with their size, and Review.
function PrRow(props: { pr: RepoPr }) {
  const full = () => repo.repo!.full_name;
  const me = () => repo.user?.login ?? "";
  const mark = () =>
    props.pr.draft
      ? "draft"
      : props.pr.decision === "APPROVED"
        ? "approved"
        : props.pr.decision === "CHANGES_REQUESTED"
          ? "changes requested"
          : props.pr.reviewers.includes(me())
            ? "your review"
            : "";
  const size = () => props.pr.docs.reduce((n, d) => n + d.additions + d.deletions, 0);
  const what = () => (props.pr.review ? `Review of ${props.pr.docs[0]?.path.split("/").pop() ?? "a doc"}` : props.pr.title);
  const summary = () => {
    const parts = [props.pr.open ? plural(props.pr.open, "open thread") : props.pr.resolved ? "all settled" : "no comments"];
    if (!props.pr.review)
      parts.push(size() ? `${plural(props.pr.docs.length, "doc")}, ±${size()} lines` : props.pr.docs.length ? plural(props.pr.docs.length, "doc") : "no docs changed");
    return parts.join(" · ");
  };
  return (
    <li>
      <details>
        <summary class="flex cursor-pointer list-none items-center gap-1.5 rounded px-0.5 py-0.5 hover:bg-hover">
          <ArrowUpIcon />
          <ArrowDownIcon />
          <span class="shrink-0 text-muted">#{props.pr.number}</span>
          <span class="min-w-0 flex-1 truncate" title={props.pr.title}>
            {what()}
          </span>
          <Show when={mark()}>
            <span class={`${badge} shrink-0 px-1.5`}>{mark()}</span>
          </Show>
        </summary>
        <div class="mt-0.5 ml-5 flex flex-col gap-1">
          <span class={props.pr.open ? "text-fg" : "text-muted"}>{summary()}</span>
          <span class="truncate text-muted" title={`${props.pr.head} → ${props.pr.base}`}>
            {props.pr.author} · {ago(props.pr.updatedAt)} · {props.pr.review ? "review" : props.pr.head} → {props.pr.base}
          </span>
          <Show when={props.pr.docs.length}>
            <ul>
              <For each={props.pr.docs}>
                {(d) => (
                  <li class="flex items-baseline gap-2">
                    <a class="min-w-0 flex-1 truncate rounded px-0.5 hover:bg-hover hover:underline" href={blobUrl(full(), props.pr.head, d.path)} title={d.path}>
                      {d.path}
                    </a>
                    <Show when={!props.pr.review && d.additions + d.deletions}>
                      <span class="shrink-0 text-muted">
                        <span class="text-green">+{d.additions}</span> <span class="text-del">−{d.deletions}</span>
                      </span>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <div class="mt-1 flex items-center gap-2">
            <button
              class={btn}
              onClick={() =>
                reviewPullRequest(
                  props.pr,
                  props.pr.docs.map((d) => d.path),
                )
              }
            >
              Review
            </button>
            <a class={`${linkBtn} ml-auto`} href={props.pr.url} target="_blank" rel="noopener">
              GitHub ↗
            </a>
          </div>
        </div>
      </details>
    </li>
  );
}
