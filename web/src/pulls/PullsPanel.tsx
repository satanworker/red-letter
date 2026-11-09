// The side panel's Pull requests tab, laid out like VS Code's GitHub Pull Requests view: "This doc" (the open PRs this
// doc takes part in, with Approve / Merge on the one from this branch), then the repo's open PRs grouped as Waiting
// for my review, Created by me and All open. A PR folds open to the docs it changed; clicking one opens it on the
// PR's branch. Review and merge are GitHub's; everything here is a GitHub call.
import { For, Show, createMemo } from "solid-js";
import { comments } from "../comments/commentsStore.ts";
import { doc } from "../doc/docStore.ts";
import { blobUrl } from "../repo/repoService.ts";
import type { PrLink, RepoPr } from "../repo/pulls.ts";
import { approvePullRequest, mergePullRequest, navigateTo, openPullRequest, prTitle, repo } from "../repo/repoStore.ts";
import { ArrowDownIcon, ArrowUpIcon, ago, badge, btn, linkBtn } from "../ui.tsx";
import { pulls } from "./pullsStore.ts";

const section = "mb-1 px-0.5 text-muted";
const pretty = (head: string) => (head.startsWith("red-letter/review/") ? "review" : head);

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
        <Show when={comments.prs.length} fallback={<p class="px-0.5 text-muted">No open pull request touches this doc.{canWrite() ? " The first comment opens one." : ""}</p>}>
          <ul class="flex flex-col gap-3">
            <For each={comments.prs}>{(pr) => <DocPr pr={pr} />}</For>
          </ul>
        </Show>
        <Show when={canWrite() && doc.session?.doc.base && !comments.prs.some((p) => p.head === repo.branch)}>
          <button class={`${linkBtn} mt-2 px-0.5 disabled:cursor-default disabled:opacity-50`} disabled={!!doc.drafting} onClick={askPr}>
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

// A PR this doc takes part in: from this branch (state, Approve, Merge) or into it (Open on its branch).
function DocPr(props: { pr: PrLink }) {
  const fromHere = () => props.pr.head === repo.branch;
  const state = () => {
    const pr = doc.pr;
    if (!pr || !fromHere()) return "";
    if (pr.mergeable === false) return `not mergeable: update from ${pr.base}`;
    if (pr.changesRequested.length) return `changes requested by ${pr.changesRequested.join(", ")}`;
    if (pr.approved.length) return `approved by ${pr.approved.join(", ")}`;
    return "";
  };
  return (
    <li class="flex flex-col gap-1.5 rounded-xl bg-card px-3 py-2.5 shadow-figma">
      <div class="flex items-baseline gap-2">
        <a class="shrink-0 text-muted hover:underline" href={props.pr.url} target="_blank" rel="noopener">
          #{props.pr.number}
        </a>
        <span class="min-w-0 flex-1 truncate" title={props.pr.title}>
          {props.pr.title}
        </span>
      </div>
      <div class="truncate text-muted" title={`${props.pr.head} → ${props.pr.base}`}>
        {pretty(props.pr.head)} → {props.pr.base}
        <Show when={state()}> · {state()}</Show>
      </div>
      <div class="flex items-center gap-2">
        <Show
          when={fromHere()}
          fallback={
            <button class={btn} onClick={() => navigateTo(blobUrl(repo.repo!.full_name, props.pr.head, repo.path))}>
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
            title={`Merge the pull request into ${props.pr.base} and delete this branch`}
            onClick={() => void mergePullRequest()}
          >
            {doc.drafting || "Merge"}
          </button>
        </Show>
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

// One PR, folded: number, title, author, age. Open: the docs it changed, each a link to that doc on the PR's branch.
function PrRow(props: { pr: RepoPr }) {
  const full = () => repo.repo!.full_name;
  const mark = () => (props.pr.draft ? "draft" : props.pr.decision === "APPROVED" ? "approved" : props.pr.decision === "CHANGES_REQUESTED" ? "changes requested" : "");
  return (
    <li>
      <details>
        <summary class="flex cursor-pointer list-none items-center gap-1.5 rounded px-0.5 py-0.5 hover:bg-hover">
          <ArrowUpIcon />
          <ArrowDownIcon />
          <span class="shrink-0 text-muted">#{props.pr.number}</span>
          <span class="min-w-0 flex-1 truncate" title={props.pr.title}>
            {props.pr.title}
          </span>
          <Show when={mark()}>
            <span class={`${badge} shrink-0 px-1.5`}>{mark()}</span>
          </Show>
        </summary>
        <div class="mt-1 ml-5 flex flex-col gap-1">
          <span class="truncate text-muted" title={`${props.pr.head} → ${props.pr.base}`}>
            {props.pr.author} · {ago(props.pr.updatedAt)} · {pretty(props.pr.head)} → {props.pr.base}
          </span>
          <Show when={props.pr.docs.length} fallback={<span class="text-muted">No markdown files changed.</span>}>
            <ul>
              <For each={props.pr.docs}>
                {(p) => (
                  <li>
                    <a class="block truncate rounded px-0.5 hover:bg-hover hover:underline" href={blobUrl(full(), props.pr.head, p)} title={p}>
                      {p}
                    </a>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <a class={`${linkBtn} self-start`} href={props.pr.url} target="_blank" rel="noopener">
            GitHub ↗
          </a>
        </div>
      </details>
    </li>
  );
}
