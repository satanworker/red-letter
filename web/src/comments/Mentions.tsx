// @mentions. In a comment or reply box, "@" lists the repo's collaborators with their GitHub avatars: Up/Down move,
// Enter or Tab picks, Esc closes the list. Bodies keep plain "@login" text, as on GitHub; MentionText shows them as
// chips.
import { For, Show, createMemo, createSignal } from "solid-js";
import type { User } from "../github.ts";
import { loadCollaborators, repo } from "../repo/repoStore.ts";
import { Avatar } from "../ui.tsx";

type Field = HTMLInputElement | HTMLTextAreaElement;

// "@que|" right before the caret, at the start or after a space
export function mentionAt(value: string, caret: number): { start: number; query: string } | null {
  const m = /(^|\s)@([\w-]*)$/.exec(value.slice(0, caret));
  return m ? { start: caret - m[2]!.length - 1, query: m[2]! } : null;
}

// Wire into a field: call `update` on input and caret moves, `onKey` first in keydown (true = the key was the list's),
// render `<List />` in a `relative` box around the field.
export function createMentions(field: () => Field | undefined, onChange: (value: string) => void) {
  const [at, setAt] = createSignal<{ start: number; query: string } | null>(null);
  const [active, setActive] = createSignal(0);
  const matches = createMemo(() => {
    const a = at();
    if (!a) return [];
    const q = a.query.toLowerCase();
    return repo.collaborators.filter((u) => u.login.toLowerCase().includes(q)).slice(0, 6);
  });
  const update = () => {
    const el = field();
    if (!el) return;
    const a = mentionAt(el.value, el.selectionStart ?? el.value.length);
    if (a) loadCollaborators();
    setAt(a);
    setActive(0);
  };
  const pick = (u: User) => {
    const el = field();
    const a = at();
    if (!el || !a) return;
    el.setRangeText(`@${u.login} `, a.start, el.selectionStart ?? a.start, "end");
    onChange(el.value);
    setAt(null);
    el.focus();
  };
  const onKey = (e: KeyboardEvent): boolean => {
    const list = matches();
    if (!at() || !list.length) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") setActive((i) => (i + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length);
    else if (e.key === "Enter" || e.key === "Tab") pick(list[active()]!);
    else if (e.key === "Escape") setAt(null);
    else return false;
    e.preventDefault();
    return true;
  };
  const List = () => (
    <Show when={matches().length}>
      <ul role="listbox" aria-label="People" class="absolute top-full left-0 z-10 mt-1 w-56 rounded-lg bg-card py-1 shadow-pop">
        <For each={matches()}>
          {(u, i) => (
            <li
              role="option"
              aria-selected={i() === active()}
              class={`flex h-8 cursor-pointer items-center gap-2 px-3 ${i() === active() ? "bg-hover" : ""}`}
              onMouseMove={() => setActive(i())}
              onMouseDown={(e) => (e.preventDefault(), pick(u))}
            >
              <Avatar login={u.login} size={20} />
              <span class="truncate">{u.login}</span>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
  return { update, onKey, List };
}

// A comment body with its @mentions as chips (any @word: collaborators can change after a comment is written).
export function MentionText(props: { text: string }) {
  return (
    <For each={props.text.split(/(?<=^|\s)(@[\w-]+)/)}>
      {(part) =>
        part.startsWith("@") ? (
          <span class="inline-flex items-center gap-0.5 rounded bg-hover px-0.5 align-bottom text-blue">
            <Avatar login={part.slice(1)} size={12} />
            {part}
          </span>
        ) : (
          part
        )
      }
    </For>
  );
}
