// Review cards for agent commits replayed into the doc: hunks to revert, conflicts to decide, "Looks good".
// Keyboard: each hunk's diff is a button that jumps to the text; Revert / Keep / Looks good are buttons.
import { For, Show, type Accessor } from "solid-js";
import { CheckIcon, Initial, ago, btn, card, linkBtn } from "../ui.tsx";
import { jump } from "./docStore.ts";
import type { AgentMark, Session } from "./session.ts";

const jumpBtn = "w-full cursor-pointer text-left";

// Cards are rebuilt when the doc changes (marks are fresh objects each time); they hold no input state.
export function AgentChanges(props: { session: Session; marks: Accessor<AgentMark[]> }) {
  const s = props.session;
  const at = (a: { from: string; to: string }) => s.resolve(a);
  return (
    <Show when={props.marks().length} fallback={<p class="px-0.5 py-3 text-muted">No agent changes waiting for review. Commits pushed with git show up here.</p>}>
      <For each={props.marks()}>
        {(m) => (
          <div class={`${card} gap-3`}>
            <div class="flex items-center gap-2">
              <Initial name={m.author} size={24} />
              <div class="flex flex-col">
                <span>{m.author}</span>
                <span class="text-muted">
                  {ago(m.at)} ·{" "}
                  <a class="underline" href={`https://github.com/${s.repoName}/commit/${m.sha}`} target="_blank">
                    {m.sha.slice(0, 7)}
                  </a>
                </span>
              </div>
            </div>
            <div class="text-muted">{m.message}</div>
            <For each={m.conflicts}>
              {(c, i) => {
                const r = at(c);
                return (
                  <div class="border-t-[.5px] border-rule pt-3">
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
                  <div class="flex items-start gap-2 border-t-[.5px] border-rule pt-3">
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
        )}
      </For>
    </Show>
  );
}
