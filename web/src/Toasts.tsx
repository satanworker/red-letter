// The window's toasts (toast.ts), bottom left over everything (above the file sidebar's branch bar): a card each in
// the dropdown menus' look (Figma 183:849), an error marked red, with Copy for text that didn't go through and × to
// close. Announced to screen readers.
import { For, Show, createSignal } from "solid-js";
import { CloseIcon, iconBtn, textBtn } from "./ui.tsx";
import { dismiss, toasts, type Toast } from "./toast.ts";

export function Toasts() {
  return (
    <div class="pointer-events-none fixed bottom-12 left-4 z-[60] flex w-[320px] max-w-[calc(100vw-32px)] flex-col gap-2" role="status" aria-live="polite">
      <For each={toasts.list}>{(t) => <ToastCard t={t} />}</For>
    </div>
  );
}

function ToastCard(props: { t: Toast }) {
  const [copied, setCopied] = createSignal(false);
  const copy = (text: string) => void navigator.clipboard.writeText(text).then(() => setCopied(true));
  return (
    <div
      class={`pointer-events-auto flex items-start gap-2 rounded-xl bg-card py-3 pr-2 pl-4 leading-4 shadow-[0_4px_17.8px_rgba(0,0,0,.1),var(--shadow)] ${props.t.kind === "error" ? "border-l-2 border-red" : ""}`}
      role={props.t.kind === "error" ? "alert" : undefined}
    >
      <p class="min-w-0 flex-1 py-0.5 [overflow-wrap:anywhere]">{props.t.text}</p>
      <Show when={props.t.copy}>
        {(text) => (
          <button type="button" class={`${textBtn} text-muted`} onClick={() => copy(text())}>
            {copied() ? "Copied" : "Copy"}
          </button>
        )}
      </Show>
      <button type="button" class={iconBtn} aria-label="Close" onClick={() => dismiss(props.t.id)}>
        <CloseIcon />
      </button>
    </div>
  );
}
