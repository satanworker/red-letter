// The file's commits as a timeline. A row opens to what that commit changed in the file (toggleCommit); the arrow
// links to it on GitHub. Agent commits whose edits interleaved with a human's carry their conflicts to settle.
// Keyboard: Up/Down/Home/End move between rows; each row's message is a button; a conflict's text jumps to it; Keep …
// are buttons, and settling a conflict leaves focus on its row.
import { For, Show, createMemo, type Accessor } from "solid-js";
import { ago, btn, card, listKeys } from "../ui.tsx";
import type { HistoryEntry } from "./docSelectors.ts";
import { doc, jump, toggleCommit } from "./docStore.ts";
import type { AgentMark, Session } from "./session.ts";

// Rows are keyed by sha, so focus in one survives the list changing (a conflict settled); they hold no input state.
export function History(props: { session: Session; entries: Accessor<HistoryEntry[]> }) {
  const s = props.session;
  return (
    <Show when={props.entries().length} fallback={<p class="px-0.5 py-3 text-muted">No commits yet. Saves and pushes with git show up here.</p>}>
      <ol onKeyDown={(e) => listKeys(e, ":scope > li")}>
        <For each={props.entries().map((x) => x.commit.sha)}>
          {(sha) => {
            const e = () => props.entries().find((x) => x.commit.sha === sha)!;
            const open = () => doc.shown?.sha === sha;
            return (
              // the line runs through every dot; the last row's stops at its dot
              <li class="relative pb-4 pl-5 before:absolute before:top-0 before:bottom-0 before:left-[4px] before:w-px before:bg-line last:pb-0 last:before:bottom-auto last:before:h-[7px]">
                <span
                  class={`absolute top-[3px] left-0 size-[9px] rounded-full ${e().conflicts ? "bg-red" : e().commit.merge ? "border-[1.5px] border-blue bg-side" : "bg-blue"}`}
                  title={e().conflicts ? "Conflicts to settle" : e().commit.merge ? "Merge" : undefined}
                />
                <div class="flex items-baseline gap-2">
                  <button
                    type="button"
                    class="min-w-0 flex-1 cursor-pointer truncate text-left hover:underline"
                    title={e().commit.message}
                    aria-expanded={open()}
                    onClick={() => toggleCommit(sha)}
                  >
                    {e().commit.message}
                  </button>
                  <a class="shrink-0 text-muted hover:text-fg" href={`https://github.com/${s.repoName}/commit/${sha}`} target="_blank" title="Open on GitHub">
                    ↗
                  </a>
                </div>
                <span class="text-muted">
                  {e().commit.author} · {ago(e().commit.date)}
                </span>
                <Show when={open() && doc.shown}>{(c) => <Patch patch={c().patch} error={c().error} />}</Show>
                <Show when={e().conflicts}>{(m) => <Conflicts session={s} mark={m()} />}</Show>
              </li>
            );
          }}
        </For>
      </ol>
    </Show>
  );
}

// GitHub's unified diff of the file: hunk headers muted, removed lines red, added green.
function Patch(props: { patch?: string | null; error?: string }) {
  const line = (l: string) => (l.startsWith("@@") ? "text-muted" : l.startsWith("+") ? "bg-green-bg text-green" : l.startsWith("-") ? "bg-red-bg text-del" : "");
  return (
    <div class="mt-2 rounded-lg bg-card py-2 shadow-figma">
      <Show when={!props.error} fallback={<p class="px-3 text-red [overflow-wrap:anywhere]">{props.error}</p>}>
        <Show when={props.patch !== undefined} fallback={<p class="px-3 text-muted">Loading…</p>}>
          <Show when={props.patch} fallback={<p class="px-3 text-muted">{props.patch === null ? "GitHub doesn't show this diff (too large)." : "No changes to this file."}</p>}>
            {(p) => (
              <pre class="font-[inherit] whitespace-pre-wrap [overflow-wrap:anywhere]">
                <For each={p().split("\n")}>{(l) => <div class={`px-3 ${line(l)}`}>{l || " "}</div>}</For>
              </pre>
            )}
          </Show>
        </Show>
      </Show>
    </div>
  );
}

function Conflicts(props: { session: Session; mark: AgentMark }) {
  const s = props.session;
  return (
    <div class={`${card} mt-2 gap-3 px-4 py-4`}>
      <For each={props.mark.conflicts}>
        {(c, i) => {
          const r = createMemo(() => (doc.version, s.resolve(c))); // where the text is now
          // settling it removes these buttons: focus goes to the row first
          const keep = (e: MouseEvent, text: string | null) => {
            (e.currentTarget as Element).closest("li")?.querySelector("button")?.focus();
            s.resolveConflict(props.mark.sha, i(), text);
          };
          return (
            <div class="border-b-[.5px] border-rule pb-3 last:border-b-0 last:pb-0">
              <div class="mb-1 font-medium text-red">⚠ You both edited this</div>
              <button
                type="button"
                class="line-clamp-3 w-full cursor-pointer border-l-2 border-red pl-2 text-left whitespace-pre-wrap text-muted"
                onClick={() => {
                  const at = r();
                  if (at) jump(at.from, at.to);
                }}
              >
                {r() ? s.doc.text.slice(r()!.from, r()!.to).slice(0, 80) : ""}
              </button>
              <Show when={s.canWrite}>
                <div class="mt-2 flex flex-col gap-1.5">
                  <button class={`${btn} truncate`} onClick={(e) => keep(e, c.human)}>
                    Keep yours: <b>{c.human.slice(0, 50) || "(nothing)"}</b>
                  </button>
                  <button class={`${btn} truncate`} onClick={(e) => keep(e, c.agent)}>
                    Keep agent's: <b>{c.agent.slice(0, 50) || "(nothing)"}</b>
                  </button>
                  <button class={`${btn} truncate`} onClick={(e) => keep(e, null)}>
                    Keep as merged
                  </button>
                </div>
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  );
}
