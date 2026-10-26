// The file's commits as a timeline, each linked to GitHub. An agent commit replayed into the doc and not yet reviewed
// opens into its review: hunks to revert, conflicts to decide, "Looks good".
// Keyboard: each hunk's diff is a button that jumps to the text; Revert / Keep / Looks good are buttons.
import { For, Show, type Accessor } from "solid-js";
import { CheckIcon, ago, btn, card, linkBtn } from "../ui.tsx";
import type { HistoryEntry } from "./docSelectors.ts";
import { jump } from "./docStore.ts";
import type { AgentMark, Session } from "./session.ts";

const jumpBtn = "w-full cursor-pointer text-left";

// Rows are rebuilt when the doc or the history changes (fresh objects each time); they hold no input state.
export function History(props: { session: Session; entries: Accessor<HistoryEntry[]> }) {
  const s = props.session;
  return (
    <Show when={props.entries().length} fallback={<p class="px-0.5 py-3 text-muted">No commits yet. Saves and pushes with git show up here.</p>}>
      <ol>
        <For each={props.entries()}>
          {(e) => (
            // the line runs through every dot; the last row's stops at its dot
            <li class="relative pb-4 pl-5 before:absolute before:top-0 before:bottom-0 before:left-[4px] before:w-px before:bg-line last:pb-0 last:before:bottom-auto last:before:h-[7px]">
              <span
                class={`absolute top-[3px] left-0 size-[9px] rounded-full ${e.review ? "bg-red" : e.commit.merge ? "border-[1.5px] border-blue bg-side" : "bg-blue"}`}
                title={e.review ? "Waiting for review" : e.commit.merge ? "Merge" : undefined}
              />
              <a class="block truncate hover:underline" href={`https://github.com/${s.repoName}/commit/${e.commit.sha}`} target="_blank" title={e.commit.message}>
                {e.commit.message}
              </a>
              <span class="text-muted">
                {e.commit.author} · {ago(e.commit.date)}
              </span>
              <Show when={e.review}>{(m) => <Review session={s} mark={m()} />}</Show>
            </li>
          )}
        </For>
      </ol>
    </Show>
  );
}

function Review(props: { session: Session; mark: AgentMark }) {
  const s = props.session;
  const m = props.mark;
  const at = (a: { from: string; to: string }) => s.resolve(a);
  return (
    <div class={`${card} mt-2 gap-3 px-4 py-4`}>
      <For each={m.conflicts}>
        {(c, i) => {
          const r = at(c);
          return (
            <div class="border-b-[.5px] border-rule pb-3">
              <div class="mb-1 font-medium text-red">⚠ You both edited this</div>
              <button type="button" class={`${jumpBtn} line-clamp-3 border-l-2 border-red pl-2 whitespace-pre-wrap text-muted`} onClick={() => r && jump(r.from, r.to)}>
                {r ? s.doc.text.slice(r.from, r.to).slice(0, 80) : ""}
              </button>
              <Show when={s.canWrite && c.human !== undefined}>
                <div class="mt-2 flex flex-col gap-1.5">
                  <button class={`${btn} truncate`} onClick={() => s.resolveConflict(m.sha, i(), c.human)}>
                    Keep yours: <b>{c.human.slice(0, 50) || "(nothing)"}</b>
                  </button>
                  <button class={`${btn} truncate`} onClick={() => s.resolveConflict(m.sha, i(), c.agent)}>
                    Keep agent's: <b>{c.agent.slice(0, 50) || "(nothing)"}</b>
                  </button>
                </div>
              </Show>
            </div>
          );
        }}
      </For>
      <For each={m.hunks}>
        {(hk, i) => {
          const r = at(hk);
          const after = r ? s.doc.text.slice(r.from, r.to) : "";
          return (
            <div class="flex items-start gap-2 border-b-[.5px] border-rule pb-3">
              <button type="button" class={`${jumpBtn} flex-1 break-words whitespace-pre-wrap`} title="Go to the text" onClick={() => r && jump(r.from, r.to)}>
                <Show when={hk.before}>
                  <del class="mr-1 rounded-[3px] bg-red-bg px-0.5 text-del">{hk.before.slice(0, 120)}</del>
                </Show>
                <Show when={after}>
                  <ins class="rounded-[3px] bg-green-bg px-0.5 text-green no-underline">{after.slice(0, 120)}</ins>
                </Show>
              </button>
              <Show when={s.canWrite}>
                <button class={linkBtn} title="Undo this change" onClick={() => s.revertHunk(m.sha, i())}>
                  Revert
                </button>
              </Show>
            </div>
          );
        }}
      </For>
      <Show when={s.canWrite}>
        <button class={`${btn} w-full justify-center`} onClick={() => s.dismiss(m.sha)}>
          <CheckIcon /> Looks good
        </button>
      </Show>
    </div>
  );
}
