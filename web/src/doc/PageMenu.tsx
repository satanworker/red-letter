// Figma 134:1701: the header's "…" menu for the open file. A native popover: light dismiss, Esc and focus return
// come with it, and the top layer puts it over the tab strip and the doc. Move / delete prompt here, then commit.
import { For, type JSX } from "solid-js";
import { deleteFile, duplicateFile, moveFile } from "../repo/repoStore.ts";
import { CopyPageIcon, DeleteIcon, DotsIcon, DuplicateIcon, LinkIcon, MoveIcon } from "../ui.tsx";
import { copyContents, doc } from "./docStore.ts";

export function PageMenu(props: { canWrite: boolean }) {
  let menu!: HTMLDivElement;
  const items = (): { label: string; icon: () => JSX.Element; run: () => unknown }[] => [
    { label: "Copy link", icon: LinkIcon, run: () => navigator.clipboard.writeText(location.href) },
    ...(props.canWrite ? [{ label: "Duplicate", icon: DuplicateIcon, run: duplicateFile }] : []),
    { label: "Copy page contents", icon: CopyPageIcon, run: copyContents },
    ...(props.canWrite
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
      >
        <For each={items()}>
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
