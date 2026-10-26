// Notion's "Add icon", over the title while the pointer is on the doc. The icon is plain markdown: an emoji at the
// start of the first `# ` heading (setIcon), so GitHub and agents see it too.
import { For, Show, createSignal } from "solid-js";
import { field, ghostBtn } from "../ui.tsx";
import { firstEmoji } from "./docSelectors.ts";
import { setIcon } from "./docStore.ts";

const EMOJI = ["📄", "📝", "📌", "📚", "📖", "📁", "📊", "📈", "🧭", "🚀", "🎯", "💡", "🔥", "⭐", "✅", "🐛"]
  .concat(["🔧", "🧪", "🔒", "🏠", "🌱", "🎨", "🧠", "💬", "📣", "💼", "🤖", "❤️", "🌍", "🎉", "⚡", "🍕"]);

export function IconPicker(props: { icon: string }) {
  const [open, setOpen] = createSignal(false);
  const pick = (icon: string) => {
    setIcon(icon);
    setOpen(false);
  };
  return (
    // h-0: floats in the editor's top padding, over the title, without moving the text
    <div class="relative z-[4] mx-auto h-0 max-w-[780px] px-8">
      <div class="relative inline-block pt-12" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
        <button
          class={`${ghostBtn} h-6 ${open() ? "" : "opacity-0 group-hover/doc:opacity-100 focus-visible:opacity-100"}`}
          aria-expanded={open()}
          onClick={() => setOpen((v) => !v)}
        >
          {props.icon ? "Change icon" : "☺ Add icon"}
        </button>
        <Show when={open()}>
          <div class="fixed inset-0" onClick={() => setOpen(false)} />
          <div role="dialog" aria-label="Doc icon" class="absolute top-full left-0 mt-1 w-[280px] rounded-lg bg-card p-2 shadow-pop">
            <div class="grid grid-cols-8">
              <For each={EMOJI}>
                {(e) => (
                  <button class="size-8 cursor-pointer rounded text-[18px] hover:bg-hover" aria-label={e} onClick={() => pick(e)}>
                    {e}
                  </button>
                )}
              </For>
            </div>
            <div class="mt-2 flex items-center gap-1">
              <input
                class={`${field} min-w-0 flex-1`}
                placeholder="Any emoji, then Enter"
                aria-label="Any emoji"
                ref={(el) => queueMicrotask(() => el.focus())} // type or paste one (or the OS emoji picker); Esc works from here
                onKeyDown={(e) => {
                  const icon = e.key === "Enter" && firstEmoji(e.currentTarget.value.trim());
                  if (icon) pick(icon);
                }}
              />
              <Show when={props.icon}>
                <button class={`${ghostBtn} h-7`} onClick={() => pick("")}>
                  Remove
                </button>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
