// The doc's table of contents, behaving as Linear's documents' (card looks: Figma 145:3163). A rail of hairlines at the
// doc's left edge, 12px apart, one per heading, right-aligned and shorter for deeper levels (8 / 6 / 4px), the
// reader's section twice as thick and dark; with more headings than fit, the rail slides to keep that one in sight
// and fades at its cut edges.
// Hovering the rail (or tabbing in) springs a card open in its place, headings indented by level; a click glides the
// doc to that heading. Leaving closes it at once. Shown for two headings or more.
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { selectHeadings } from "./docSelectors.ts";
import { doc, headingInView, scrollToHeading } from "./docStore.ts";
import type { Session } from "./session.ts";

const PITCH = 12; // px from bar to bar
const WIDTH = [8, 6, 4]; // bar length by depth below the doc's top heading level

export function Toc(props: { session: Session }) {
  const headings = createMemo(() => {
    doc.version; // the CRDT doc changed
    return selectHeadings(props.session.doc.text);
  });
  const [active, setActive] = createSignal(0);
  const [railHeight, setRailHeight] = createSignal(0);
  let scroller!: HTMLElement;
  let rail!: HTMLDivElement;
  const update = () => {
    setActive(headingInView(headings(), scroller));
    setRailHeight(rail.clientHeight);
  };
  onMount(() => {
    scroller = document.getElementById("doc")!;
    scroller.addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    queueMicrotask(update);
    onCleanup(() => {
      scroller.removeEventListener("scroll", update);
      removeEventListener("resize", update);
    });
  });
  // how far the bars slide up so the active one stays mid-rail; 0 when they all fit
  const shift = () => {
    const over = headings().length * PITCH - railHeight();
    return over > 0 ? Math.min(over, Math.max(0, active() * PITCH - railHeight() / 2)) : 0;
  };
  const mask = () => {
    const over = headings().length * PITCH - railHeight();
    if (over <= 0) return "none";
    const fade = (on: boolean) => (on ? "12px" : "0px");
    return `linear-gradient(to bottom, transparent 0, #000 ${fade(shift() > 0)}, #000 calc(100% - ${fade(shift() < over)}), transparent 100%)`;
  };
  return (
    <Show when={headings().length > 1}>
      <nav
        aria-label="Contents"
        class="group/toc pointer-events-none absolute inset-y-0 left-0 z-[5] hidden pt-[35px] @3xl:flex @3xl:items-center"
      >
        {/* the rail: only its bars and a little room to their right catch the pointer, as in Linear */}
        <div
          ref={rail}
          class="pointer-events-auto my-1 ml-1 max-h-[calc(100%-60px)] overflow-hidden pr-6 transition-opacity duration-100 group-focus-within/toc:opacity-0 group-hover/toc:opacity-0 group-hover/toc:duration-200"
          style={{ "mask-image": mask() }}
          aria-hidden="true"
        >
          <div class="flex w-2 flex-col transition-transform duration-200" style={{ transform: `translateY(${-shift()}px)` }}>
            <For each={headings()}>
              {(h, i) => (
                <span class="flex h-3 shrink-0 items-center justify-end">
                  <span
                    class={`h-px transition-[background-color,scale] duration-150 ${i() === active() ? "scale-y-200 bg-fg" : "bg-line"}`}
                    style={{ width: `${WIDTH[h.depth]}px` }}
                  />
                </span>
              )}
            </For>
          </div>
        </div>
        {/* the card springs out of the rail's spot: from half size, 16px left and transparent */}
        <div class="pointer-events-none absolute top-[calc(50%+17.5px)] left-1.5 flex max-h-[calc(100%-95px)] origin-left -translate-x-4 -translate-y-1/2 scale-50 flex-col gap-2 overflow-y-auto rounded-xl bg-card px-5 py-6 opacity-0 shadow-[0_4px_17.8px_rgba(0,0,0,.1),var(--shadow)] transition-[opacity,translate,scale] duration-100 ease-out group-focus-within/toc:pointer-events-auto group-focus-within/toc:translate-x-0 group-focus-within/toc:scale-100 group-focus-within/toc:opacity-100 group-hover/toc:pointer-events-auto group-hover/toc:translate-x-0 group-hover/toc:scale-100 group-hover/toc:opacity-100 group-hover/toc:delay-[40ms] group-hover/toc:duration-200 group-hover/toc:ease-[cubic-bezier(.34,1.3,.64,1)]">
          <For each={headings()}>
            {(h, i) => (
              <button
                class={`-mx-1.5 max-w-[240px] shrink-0 cursor-pointer truncate rounded px-1.5 text-left leading-4 transition-colors duration-150 hover:bg-hover hover:text-fg ${i() === active() ? "text-fg" : h.depth ? "text-muted" : "text-fg/65"}`}
                style={{ "margin-left": `${h.depth * 12 - 6}px` }}
                aria-current={i() === active() ? "location" : undefined}
                onClick={() => scrollToHeading(h, scroller)}
              >
                {h.text}
              </button>
            )}
          </For>
        </div>
      </nav>
    </Show>
  );
}
