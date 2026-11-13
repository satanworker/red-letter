// A draft's bar over the doc, after GitBook's change requests: which draft this is, where it stands, and everything to
// do with it. Git's words stay out of it: a draft is a branch, Ask for review opens its pull request (reviewers asked
// on it), Publish merges it, Discard closes it and deletes the branch. Who can start one: canStartDraft.
import { For, Show, createMemo, createSignal } from "solid-js";
import { doc, toggleChanges, updateDraft } from "../doc/docStore.ts";
import { selectDraftStatus } from "../doc/docSelectors.ts";
import { isReviewBranch } from "../repo/pulls.ts";
import {
  approvePullRequest,
  askForReview,
  discardDraft,
  loadCollaborators,
  prTitle,
  publishDraft,
  repo,
  requestChangesOnPullRequest,
  startDraft,
} from "../repo/repoStore.ts";
import { Avatar, btn, linkBtn, primaryBtn } from "../ui.tsx";

const disabled = "disabled:cursor-default disabled:opacity-50";
const TONE: Record<string, string> = { Approved: "text-green", "Changes requested": "text-red", "In review": "text-blue" };

// The open doc is a draft: a branch forked here (it records its base) or one with an open pull request; never the
// default branch or a review branch (comments only).
export function onDraft(): boolean {
  doc.version; // doc.base lives in the CRDT doc
  const s = doc.session;
  return !!s && s.branch !== repo.repo?.default_branch && !isReviewBranch(s.branch) && (!!s.doc.base || !!doc.pr);
}
// A draft can start from any branch that isn't one (a protected main included: that's the point), with push access.
export const canStartDraft = () => !!repo.repo?.permissions?.push && !!doc.session && !onDraft();
export function promptDraft() {
  const name = prompt(`Name your draft (optional). Its edits stay off ${repo.branch} until you publish.`, "");
  if (name !== null) void startDraft(name);
}

export function DraftBar() {
  const base = createMemo(() => {
    doc.version;
    return doc.session?.doc.base;
  });
  const status = createMemo(() => selectDraftStatus(doc.pr));
  const target = () => base()?.branch ?? doc.pr?.base ?? repo.repo?.default_branch ?? "";
  const mine = () => !doc.pr || doc.pr.author === repo.user?.login;
  const moved = () => !!base() && !!doc.status.baseHead && doc.status.baseHead !== base()!.commit;
  const publish = () => confirm(`Publish to ${target()}? Everyone sees these edits there.`) && void publishDraft();
  const discard = () =>
    confirm(`Discard this draft? Its edits${doc.pr ? " and its review" : ""} are deleted; ${target()} stays as it is.`) && void discardDraft();
  const requestChanges = () => {
    const note = prompt("What should change?");
    if (note && doc.pr) void requestChangesOnPullRequest(doc.pr.number, note);
  };
  return (
    <div class="flex shrink-0 items-center gap-3 border-b-[.5px] border-line bg-bg2 px-4 py-2 whitespace-nowrap" role="region" aria-label="Draft">
      <span class="text-muted" title={`Nobody sees these edits on ${target()} until you publish`}>
        Draft of {target()} ·
      </span>
      <span class="font-medium">{doc.pr?.title ?? prTitle(repo.branch)}</span>
      <span class={`rounded-xl border-[.4px] border-line px-1.5 font-light ${TONE[status().label] ?? "text-muted"}`}>{status().label}</span>
      <span class="min-w-0 flex-1 truncate text-muted">{status().detail}</span>
      <Show when={doc.drafting}>
        <span class="text-muted">{doc.drafting}</span>
      </Show>
      <Show when={base()}>
        <button class={`${btn} ${doc.showChanges ? "bg-on" : ""}`} aria-pressed={doc.showChanges} title={`Highlight what this draft changed from ${target()}`} onClick={toggleChanges}>
          Changes
        </button>
      </Show>
      <Show when={moved()}>
        <button class={`${btn} ${disabled}`} disabled={!!doc.drafting} title={`${target()} has new edits: bring them into this draft`} onClick={() => void updateDraft()}>
          Bring in edits from {target()}
        </button>
      </Show>
      <Show when={mine()} fallback={<Verdicts requestChanges={requestChanges} />}>
        <AskForReview />
      </Show>
      <button
        class={`${primaryBtn} h-7 ${disabled}`}
        disabled={!!doc.drafting || doc.pr?.mergeable === false}
        title={doc.pr?.mergeable === false ? `GitHub can't merge this into ${target()} as it is (conflicts): bring in its edits first` : `Put these edits on ${target()}`}
        onClick={publish}
      >
        Publish to {target()}
      </button>
      <button class={`${linkBtn} ${disabled}`} disabled={!!doc.drafting} onClick={discard}>
        Discard
      </button>
      <Show when={doc.pr}>
        {(pr) => (
          <a class={linkBtn} href={pr().url} target="_blank" rel="noopener" title={`Pull request #${pr().number} on GitHub`}>
            GitHub ↗
          </a>
        )}
      </Show>
    </div>
  );
}

// Someone else's draft: GitHub's verdicts, refused on your own pull request
function Verdicts(props: { requestChanges: () => void }) {
  return (
    <>
      <button class={`${btn} ${disabled}`} disabled={!!doc.drafting} onClick={() => void approvePullRequest()}>
        Approve
      </button>
      <button class={`${btn} ${disabled}`} disabled={!!doc.drafting} onClick={props.requestChanges}>
        Request changes
      </button>
    </>
  );
}

// "Ask for review": a native popover listing the repo's collaborators to tick (GitHub notifies them). With nobody
// ticked it still opens the review, for whoever looks.
function AskForReview() {
  let pop!: HTMLDivElement;
  const [picked, setPicked] = createSignal<string[]>([]);
  const people = () => repo.collaborators.filter((u) => u.login !== repo.user?.login && !doc.pr?.reviewers.includes(u.login));
  const open = (b: HTMLElement) => {
    loadCollaborators();
    const r = b.getBoundingClientRect();
    Object.assign(pop.style, { top: `${r.bottom + 4}px`, right: `${innerWidth - r.right}px` });
  };
  const send = () => {
    pop.hidePopover();
    if (picked().length || !doc.pr) void askForReview(picked());
    setPicked([]);
  };
  return (
    <>
      <button class={`${btn} ${disabled}`} disabled={!!doc.drafting} popoverTarget="draft-reviewers" onClick={(e) => open(e.currentTarget)}>
        {doc.pr ? "Ask someone" : "Ask for review"}
      </button>
      <div
        ref={pop}
        id="draft-reviewers"
        popover
        class="fixed inset-auto m-0 w-64 flex-col gap-2 rounded-xl bg-card px-4 py-4 text-fg shadow-[0_4px_17.8px_rgba(0,0,0,.1),var(--shadow)] [&:popover-open]:flex"
      >
        <p class="text-muted">Who should review it? GitHub lets them know.</p>
        <div class="flex max-h-60 flex-col gap-1.5 overflow-auto">
          <For each={people()} fallback={<p class="text-muted">{repo.collaborators.length ? "Nobody else to ask here." : "Loading people…"}</p>}>
            {(u) => (
              <label class="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={picked().includes(u.login)}
                  onChange={(e) => setPicked(e.currentTarget.checked ? [...picked(), u.login] : picked().filter((x) => x !== u.login))}
                />
                <Avatar login={u.login} size={16} />
                {u.login}
              </label>
            )}
          </For>
        </div>
        <button class={`${primaryBtn} h-7`} onClick={send}>
          {picked().length ? `Ask ${picked().join(", ")}` : doc.pr ? "Done" : "Open for review"}
        </button>
      </div>
    </>
  );
}
