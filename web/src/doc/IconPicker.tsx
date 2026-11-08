// Notion's "Add icon", over the title while the pointer is on the doc. The icon is plain markdown: an emoji at the
// start of the first `# ` heading (setIcon), so GitHub and agents see it too.
// The picker is emoji-picker-element: every emoji in the OS emoji font, with search, categories, skin tones and
// recents. Its script loads on first open; its data is our own asset, kept in IndexedDB after the first open.
import dataSource from "emoji-picker-element-data/en/emojibase/data.json" with { type: "file" };
import { Show, createSignal } from "solid-js";
import { ghostBtn } from "../ui.tsx";
import { setIcon } from "./docStore.ts";

export function IconPicker(props: { icon: string }) {
  const [open, setOpen] = createSignal(false);
  const pick = (icon: string) => {
    setIcon(icon);
    setOpen(false);
  };
  const mount = async (el: HTMLElement) => {
    const { Picker } = await import("emoji-picker-element");
    if (!el.isConnected) return; // closed while it loaded
    const picker = new Picker({ dataSource });
    picker.addEventListener("emoji-click", (e) => e.detail.unicode && pick(e.detail.unicode));
    el.append(picker);
    picker.shadowRoot?.getElementById("search")?.focus(); // type to search (or use the OS emoji picker); Esc works from here
  };
  return (
    // h-0: floats in the editor's top padding, over the title, without moving the text. Width and padding are
    // .cm-content's (684px, 30px + the line's 2px), so the label starts where the title's first letter does.
    <div class="relative z-[4] mx-auto h-0 max-w-[684px] px-8">
      <div class="relative inline-block pt-12" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
        <button
          class={`${ghostBtn} -ml-1 h-6 ${open() ? "" : "opacity-0 group-hover/doc:opacity-100 focus-visible:opacity-100"}`}
          aria-expanded={open()}
          onClick={() => setOpen((v) => !v)}
        >
          {props.icon ? "Change icon" : "☺ Add icon"}
        </button>
        <Show when={open()}>
          <div class="fixed inset-0" onClick={() => setOpen(false)} />
          <div role="dialog" aria-label="Doc icon" class="absolute top-full left-0 mt-1 overflow-hidden rounded-lg bg-card shadow-pop">
            <div ref={(el) => void mount(el)} />
            <Show when={props.icon}>
              <div class="flex justify-end p-1">
                <button class={`${ghostBtn} h-7`} onClick={() => pick("")}>
                  Remove
                </button>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
