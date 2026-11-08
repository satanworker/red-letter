// The doc's outline in the side panel, laid out as Ulysses' sidebar. Outline: a muted label, then one row per heading,
// a hollow circle before its words (in full on hover), indented by level; the reader's section sits on a grey pill; a
// click glides the doc to that heading. Links (when there are any), under a rule: one row per `[text](url)` with a blue
// circle, its text and url on hover; a click brings it to the middle of the view. Either way the target flashes (flash.ts).
import { For, Show, createEffect, createMemo, createSelector, createSignal, onCleanup, onMount } from "solid-js";
import { selectHeadings } from "./docSelectors.ts";
import { doc, editorState, headingInView, scrollToHeading, showLink } from "./docStore.ts";
import { headingField } from "./headings.ts";

export function Outline() {
  const found = createMemo(() => {
    doc.version; // the CRDT doc changed
    return editorState()?.field(headingField);
  });
  const headings = createMemo(() => selectHeadings(found()?.found ?? []));
  // What the rows draw. Typing moves the headings' positions on every keystroke but rarely their words or levels: an
  // unchanged outline keeps the same array, so the list doesn't redraw.
  const outline = createMemo(
    () => headings().map((h) => ({ depth: h.depth, text: h.text })),
    undefined,
    { equals: (a, b) => a.length === b.length && a.every((h, i) => h.depth === b[i]!.depth && h.text === b[i]!.text) },
  );
  const links = createMemo(
    () => (found()?.links ?? []).map((l) => ({ text: l.text, url: l.url })),
    undefined,
    { equals: (a, b) => a.length === b.length && a.every((l, i) => l.text === b[i]!.text && l.url === b[i]!.url) },
  );
  const [active, setActive] = createSignal(0);
  const isActive = createSelector(active); // a scroll that changes the section restyles two rows, not every one
  const scroller = document.getElementById("doc")!;
  const update = () => headingInView(headings(), scroller, setActive);
  createEffect(() => (outline(), update())); // on open and when headings come or go
  onMount(() => {
    scroller.addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    onCleanup(() => {
      scroller.removeEventListener("scroll", update);
      removeEventListener("resize", update);
    });
  });
  return (
    <nav aria-label="Outline">
      <h2 class="mb-2 px-0.5 font-medium text-muted">Outline</h2>
      <Show when={outline().length} fallback={<p class="px-0.5 py-1 text-muted">No headings yet. Lines starting with # show up here.</p>}>
        <For each={outline()}>
          {(h, i) => (
            <button
              class={`flex h-6 w-full cursor-pointer items-center gap-1.5 rounded-md pr-1.5 text-left text-fg hover:bg-hover ${isActive(i()) ? "bg-on" : ""}`}
              style={{ "padding-left": `${6 + h.depth * 16}px` }}
              title={h.text}
              aria-current={isActive(i()) ? "location" : undefined}
              onClick={() => scrollToHeading(headings()[i()]!, scroller)}
            >
              <span class="size-[7px] shrink-0 rounded-full border border-muted" />
              <span class="truncate">{h.text}</span>
            </button>
          )}
        </For>
      </Show>
      <Show when={links().length}>
        <h2 class="mt-4 mb-2 border-t-[.5px] border-rule px-0.5 pt-4 font-medium text-muted">Links</h2>
        <For each={links()}>
          {(l, i) => (
            <button
              class="flex h-6 w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-left text-fg hover:bg-hover"
              title={`${l.text}\n${l.url}`}
              onClick={() => {
                const at = found()?.links[i()];
                if (at) showLink(at.from, at.to);
              }}
            >
              <span class="size-[7px] shrink-0 rounded-full border border-blue" />
              <span class="truncate">{l.text}</span>
            </button>
          )}
        </For>
      </Show>
    </nav>
  );
}
