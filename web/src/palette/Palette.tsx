// Notion-style Cmd/Ctrl+K palette: type to filter files and actions, Up/Down to move, Enter to run, Esc to close.
// Focus returns to wherever it was when the palette opened.
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { showTab, startComment } from "../doc/docStore.ts";
import { blobUrl } from "../repo/repoService.ts";
import { navigateTo, repo, toggleFiles } from "../repo/repoStore.ts";
import { FileIcon, card } from "../ui.tsx";
import { closePalette } from "./paletteStore.ts";

type Item = { label: string; hint?: string; file?: boolean; run: () => void };

// Every character of the query, in order (case-insensitive); earlier and tighter matches rank first.
function score(label: string, q: string): number | null {
  const l = label.toLowerCase();
  const at = l.indexOf(q);
  if (at >= 0) return at;
  let i = 0;
  for (const ch of q) {
    i = l.indexOf(ch, i);
    if (i < 0) return null;
    i++;
  }
  return 1000 + i;
}

export function Palette() {
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  const actions = (): Item[] => [
    { label: "Comment on selection", hint: "⌘⌥M", run: startComment },
    { label: "Show comments", run: () => showTab("comments") },
    { label: "Show history", run: () => showTab("history") },
    { label: repo.filesHidden ? "Show files" : "Hide files", run: toggleFiles },
    { label: "Copy link to this file", run: () => void navigator.clipboard.writeText(location.href) },
  ];
  const items = createMemo(() => {
    const q = query().trim().toLowerCase();
    const files: Item[] = repo.docs.map((p) => ({ label: p, file: true, run: () => navigateTo(blobUrl(repo.repo!.full_name, repo.branch, p)) }));
    const all = [...actions(), ...files];
    if (!q) return all;
    return all
      .map((it) => ({ it, s: score(it.label, q) }))
      .filter((x): x is { it: Item; s: number } => x.s !== null)
      .sort((a, b) => a.s - b.s)
      .map((x) => x.it);
  });
  const run = (it: Item | undefined) => {
    if (!it) return;
    closePalette();
    it.run();
  };
  const keys = (e: KeyboardEvent) => {
    const n = items().length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (n ? (i + (e.key === "ArrowDown" ? 1 : n - 1)) % n : 0));
      document.getElementById(`palette-${active()}`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(items()[active()]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
    }
  };
  const back = document.activeElement as HTMLElement | null;
  let input!: HTMLInputElement;
  onMount(() => input.focus());
  onCleanup(() => back?.focus());

  return (
    <div class="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(0,0,0,.2)] pt-[15vh]" onMouseDown={(e) => e.target === e.currentTarget && closePalette()}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" class={`${card} w-[560px] max-w-[calc(100vw-32px)] gap-2 px-0 py-2 shadow-pop`}>
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={items().length ? `palette-${active()}` : undefined}
          placeholder="Search files and actions…"
          class="mx-3 h-8 border-b-[.5px] border-rule bg-transparent px-1 text-[14px] outline-none placeholder:text-mark"
          onInput={(e) => (setQuery(e.currentTarget.value), setActive(0))}
          onKeyDown={keys}
        />
        <ul id="palette-list" role="listbox" class="max-h-[50vh] overflow-auto px-1.5">
          <For each={items()} fallback={<li class="px-3 py-2 text-muted">Nothing matches.</li>}>
            {(it, i) => (
              <li
                id={`palette-${i()}`}
                role="option"
                aria-selected={i() === active()}
                class={`flex h-8 cursor-pointer items-center gap-2 rounded-md px-3 ${i() === active() ? "bg-hover" : ""}`}
                onMouseMove={() => setActive(i())}
                onClick={() => run(it)}
              >
                <Show when={it.file}>
                  <FileIcon />
                </Show>
                <span class="flex-1 truncate">{it.label}</span>
                <Show when={it.hint}>
                  <span class="text-muted">{it.hint}</span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </div>
    </div>
  );
}
