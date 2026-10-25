// Review cards for agent commits replayed into the doc: hunks to revert, conflicts to decide, "Looks good".
import { For, Show, type Accessor } from "solid-js";
import { CheckIcon, Initial, ago } from "../ui.tsx";
import { selectConflictCount } from "./docSelectors.ts";
import { jump, showTab } from "./docStore.ts";
import type { AgentMark, Session } from "./session.ts";

// Banner over the document: agent work waiting for review.
export function Banner(props: { marks: Accessor<AgentMark[]> }) {
  const conflicts = () => selectConflictCount(props.marks());
  const count = () => props.marks().length;
  return (
    <div id="banner">
      <Show when={props.marks().at(-1)}>
        {(m) => (
          <div class="banner" classList={{ bad: conflicts() > 0 }}>
            <Initial name={m().author} size={20} />
            <span>
              <b>{m().author}</b> pushed {count() > 1 ? `${count()} commits` : "changes"}
              <Show when={conflicts()}>
                {" "}
                · <b>{`${conflicts()} need${conflicts() > 1 ? "" : "s"} a decision`}</b>
              </Show>
            </span>
            <button class="btn ghost small" onClick={() => showTab("changes")}>
              Review
            </button>
          </div>
        )}
      </Show>
    </div>
  );
}

// Cards are rebuilt when the doc changes (marks are fresh objects each time); they hold no input state.
export function AgentChanges(props: { session: Session; marks: Accessor<AgentMark[]> }) {
  const s = props.session;
  const at = (a: { from: string; to: string }) => s.resolve(a);
  return (
    <Show when={props.marks().length} fallback={<p class="empty">No agent changes waiting for review. Commits pushed with git show up here.</p>}>
      <For each={props.marks()}>
        {(m) => (
          <div class="card">
            <div class="who">
              <Initial name={m.author} size={24} />
              <div class="name">
                <span>{m.author}</span>
                <div class="meta">
                  {ago(m.at)} ·{" "}
                  <a href={`https://github.com/${s.repoName}/commit/${m.sha}`} target="_blank">
                    {m.sha.slice(0, 7)}
                  </a>
                </div>
              </div>
            </div>
            <div class="msg">{m.message}</div>
            <For each={m.conflicts}>
              {(c, i) => {
                const r = at(c);
                return (
                  <div class="hunk conflict" onClick={() => r && jump(r.from, r.to)}>
                    <div class="label">⚠ You both edited this</div>
                    <q>{r ? s.doc.text.slice(r.from, r.to).slice(0, 80) : ""}</q>
                    <Show when={s.canWrite && c.human !== undefined}>
                      <div class="choices">
                        <button
                          class="btn small"
                          onClick={(e) => {
                            e.stopPropagation();
                            s.resolveConflict(m.sha, i(), c.human);
                          }}
                        >
                          Keep yours: <b>{c.human.slice(0, 50) || "(nothing)"}</b>
                        </button>
                        <button
                          class="btn small"
                          onClick={(e) => {
                            e.stopPropagation();
                            s.resolveConflict(m.sha, i(), c.agent);
                          }}
                        >
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
                  <div class="hunk" onClick={() => r && jump(r.from, r.to)}>
                    <div class="diff">
                      <Show when={hk.before}>
                        <del>{hk.before.slice(0, 120)}</del>
                      </Show>
                      <Show when={after}>
                        <ins>{after.slice(0, 120)}</ins>
                      </Show>
                    </div>
                    <Show when={s.canWrite}>
                      <button
                        class="link"
                        title="Undo this change"
                        onClick={(e) => {
                          e.stopPropagation();
                          s.revertHunk(m.sha, i());
                        }}
                      >
                        Revert
                      </button>
                    </Show>
                  </div>
                );
              }}
            </For>
            <Show when={s.canWrite}>
              <button class="btn small wide" onClick={() => s.dismiss(m.sha)}>
                <CheckIcon /> Looks good
              </button>
            </Show>
          </div>
        )}
      </For>
    </Show>
  );
}
