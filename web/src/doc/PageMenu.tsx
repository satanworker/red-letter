// Figma 134:1701: the header's "…" menu for the open file. A native popover: light dismiss, Esc and focus return
// come with it, and the top layer puts it over the tab strip and the doc. Move / delete prompt here, then commit.
// Keyboard: opening it focuses the first item, Up/Down/Home/End move. The ⌘K palette lists the same items.
import { For, onMount, type JSX } from "solid-js";
import { deleteFile, duplicateFile, forkBranch, moveFile, repo } from "../repo/repoStore.ts";
import { BranchIcon, CopyPageIcon, DeleteIcon, DotsIcon, DuplicateIcon, LinkIcon, MoveIcon, listKeys } from "../ui.tsx";
import { copyContents, doc } from "./docStore.ts";

export const pageItems = (canWrite: boolean): { label: string; icon: () => JSX.Element; run: () => unknown }[] => [
  { label: "Copy link", icon: LinkIcon, run: () => navigator.clipboard.writeText(location.href) },
  ...(canWrite ? [{ label: "Duplicate", icon: DuplicateIcon, run: duplicateFile }] : []),
  { label: "Copy page contents", icon: CopyPageIcon, run: copyContents },
  // this file on a new branch; from any branch without a recorded base, a protected main included (that's the point)
  ...(repo.repo?.permissions?.push && !doc.session?.doc.base
    ? [
        {
          label: "New branch",
          icon: BranchIcon,
          run: () => {
            const stem = doc.session!.path.split("/").pop()!.replace(/\.[^.]+$/, "");
            const name = prompt("Branch name", `${repo.user!.login}/${stem}-edits`);
            return name && forkBranch(name);
          },
        },
      ]
    : []),
  ...(canWrite
    ? [
        {
          label: "Move to",
          icon: MoveIcon,
          run: () => {
            const to = prompt("Move to", doc.session!.path);
            return to !== null && moveFile(to);
          },
        },
        { label: "Delete page", icon: DeleteIcon, run: () => confirm(`Delete ${doc.session!.path}? Git history keeps it.`) && deleteFile() },
      ]
    : []),
];

export function PageMenu(props: { canWrite: boolean }) {
  let menu!: HTMLDivElement;
  onMount(() => menu.addEventListener("toggle", (e) => (e as ToggleEvent).newState === "open" && menu.querySelector("button")?.focus()));
  // under the button, right edges aligned
  const place = (b: HTMLElement) => {
    const r = b.getBoundingClientRect();
    Object.assign(menu.style, { top: `${r.bottom + 4}px`, right: `${innerWidth - r.right}px` });
  };
  return (
    <>
      <button
        class="mt-[5.5px] ml-3 grid size-6 shrink-0 cursor-pointer place-items-center rounded-lg hover:bg-hover"
        title="More"
        aria-label="More"
        popoverTarget="page-menu"
        onClick={(e) => place(e.currentTarget)}
      >
        <DotsIcon />
      </button>
      <div
        ref={menu}
        id="page-menu"
        popover
        role="menu"
        class="fixed inset-auto m-0 flex-col gap-2 rounded-xl bg-card px-5 py-6 text-fg shadow-[0_4px_17.8px_rgba(0,0,0,.1),var(--shadow)] [&:popover-open]:flex"
        onKeyDown={(e) => listKeys(e, "button")}
      >
        <For each={pageItems(props.canWrite)}>
          {(it) => (
            <button
              role="menuitem"
              class="-mx-1.5 flex cursor-pointer items-center gap-1 rounded px-1.5 text-left leading-4 whitespace-nowrap hover:bg-hover"
              onClick={() => {
                menu.hidePopover();
                void it.run();
              }}
            >
              <it.icon />
              {it.label}
            </button>
          )}
        </For>
      </div>
    </>
  );
}
