// Save: everything unsaved on the file (anyone's) becomes one commit, an optional note its title. Until then edits are
// only kept (Session.keep), so the branch's history holds what someone chose to save, not every pause in typing.
// A native popover like PageMenu: light dismiss, Esc and focus return come with it.
import { onMount } from "solid-js";
import { btn, primaryBtn } from "../ui.tsx";
import { doc, saveDoc } from "./docStore.ts";

// ⌘S: the popover, on its note; Enter saves. Nothing to save, nothing opens.
export function openSave() {
  if (doc.status.dirty && doc.session?.canWrite) document.querySelector<HTMLElement>("#save-note")?.showPopover();
}

export function SaveButton() {
  let button!: HTMLButtonElement;
  let pop!: HTMLFormElement;
  let note!: HTMLInputElement;
  onMount(() => {
    // under the button, right edges aligned, before it shows (⌘S opens it without a click)
    pop.addEventListener("beforetoggle", (e) => {
      if ((e as ToggleEvent).newState !== "open") return;
      const r = button.getBoundingClientRect();
      Object.assign(pop.style, { top: `${r.bottom + 4}px`, right: `${innerWidth - r.right}px` });
    });
    pop.addEventListener("toggle", (e) => (e as ToggleEvent).newState === "open" && note.focus());
  });
  return (
    <>
      <button ref={button} class={btn} popoverTarget="save-note">
        Save
      </button>
      <form
        ref={pop}
        id="save-note"
        popover
        class="fixed inset-auto m-0 w-72 flex-col gap-2 rounded-xl bg-card px-4 py-4 text-fg shadow-[0_4px_17.8px_rgba(0,0,0,.1),var(--shadow)] [&:popover-open]:flex"
        onSubmit={(e) => {
          e.preventDefault();
          pop.hidePopover();
          void saveDoc(note.value);
          note.value = "";
        }}
      >
        <input ref={note} class="h-7 w-full rounded-lg border-[.4px] border-line px-2 outline-none placeholder:text-muted" placeholder="What changed? (optional)" aria-label="What changed" />
        <button class={`${primaryBtn} h-7`}>Save</button>
      </form>
    </>
  );
}
