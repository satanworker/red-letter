// Small shared pieces: avatars, icons, the logo, relative times, and the class strings every screen reuses.
// Design icons are the SVGs exported from Figma (src/icons/); the few the design lacks stay inline SVG (currentColor).
import type { JSX } from "solid-js";
import arrowDownSvg from "./icons/arrow-down.svg";
import arrowUpSvg from "./icons/arrow-up.svg";
import commentSvg from "./icons/comment.svg";
import createDocSvg from "./icons/create-doc.svg";
import documentSvg from "./icons/document.svg";
import folderSvg from "./icons/folder.svg";
import searchSvg from "./icons/search.svg";
import tipArrowSvg from "./icons/tip-arrow.svg";
import atSignSvg from "./icons/at-sign.svg";
import editSvg from "./icons/edit.svg";
import newFileSvg from "./icons/new-file.svg";
import findSvg from "./icons/find.svg";
import closeSvg from "./icons/close.svg";
import plusSvg from "./icons/plus.svg";
import dotsSvg from "./icons/dots.svg";
import commentDotsSvg from "./icons/comment-dots.svg";
import linkSvg from "./icons/link.svg";
import duplicateSvg from "./icons/duplicate.svg";
import copyPageSvg from "./icons/copy-page.svg";
import moveSvg from "./icons/move.svg";
import deleteSvg from "./icons/delete.svg";
import logoSvg from "./icons/logo.svg";
import bookSvg from "./icons/book.svg";
import githubStrokeSvg from "./icons/github-stroke.svg";
import githubMarkSvg from "./icons/github-mark.svg";
import branchSvg from "./icons/branch.svg";

// Figma 184:1116 "HOVER AND ACTIVE", for every borderless button and row: hovered, a .5px Shadows outline with the
// button shadow; pressed or on (aria-pressed / aria-expanded / the open row), filled Dark Grey. `active:` comes after
// `hover:` in Tailwind's order, so a pressed button shows pressed. Class names are spelled out: Tailwind only
// generates the ones it finds written in the source.
const hoverRing = "hover:shadow-[inset_0_0_0_.5px_var(--line),var(--shadow)] disabled:hover:shadow-none";
export const pressed = "bg-rule shadow-figma";
// a 15px icon in its 20px box (Figma 184:1203 / 184:1212)
export const iconBtn = `grid size-5 shrink-0 cursor-pointer place-items-center rounded ${hoverRing} active:bg-rule active:shadow-figma aria-pressed:bg-rule aria-pressed:shadow-figma aria-expanded:bg-rule aria-expanded:shadow-figma disabled:cursor-default`;
// a word ("Share": Figma 184:1219 / 184:1218), 20px tall, 4px each side
export const textBtn = `inline-flex h-5 shrink-0 cursor-pointer items-center rounded px-1 ${hoverRing} active:bg-rule active:shadow-figma aria-pressed:bg-rule aria-pressed:shadow-figma aria-expanded:bg-rule aria-expanded:shadow-figma`;
// a file tree row, a menu item: the same, Figma 184:1168 / 184:1169
export const rowHover = hoverRing;
// Figma 183:849 / 190:1914, every dropdown menu: a white card (12px corners, 24 / 20 padding, the menu shadow), items
// 8px apart in Onyx, groups parted by a .5px Shadows rule; a native popover each (light dismiss, Esc, the top layer).
export const menuCard =
  "fixed inset-auto m-0 min-w-[200px] flex-col gap-2 rounded-xl bg-card px-5 py-6 text-fg shadow-[0_4px_17.8px_rgba(0,0,0,.1),var(--shadow)] [&:popover-open]:flex";
export const menuItem = `-mx-1.5 flex cursor-pointer items-center gap-2 rounded px-1.5 text-left leading-4 whitespace-nowrap ${hoverRing} aria-checked:bg-rule disabled:cursor-default disabled:text-muted`;
export const MenuRule = () => <hr class="m-0 border-0 border-t-[.5px] border-line" />;
// A popover menu next to the control that opens it: under it (over it near the window's foot), its right edge on the
// control's (`end`) or its left edge (`start`)
export function placeMenu(menu: HTMLElement, by: HTMLElement, side: "below" | "above" = "below", align: "end" | "start" = "end") {
  const r = by.getBoundingClientRect();
  Object.assign(
    menu.style,
    side === "below" ? { top: `${r.bottom + 4}px`, bottom: "auto" } : { bottom: `${innerHeight - r.top + 4}px`, top: "auto" },
    align === "end" ? { right: `${innerWidth - r.right}px`, left: "auto" } : { left: `${r.left}px`, right: "auto" },
  );
}
// Figma "Reply"/"Resolve": 24px tall, width = text + 24 with the .4px stroke inside. Pills keep their stroke: hovered it
// darkens to Shadows, pressed they fill Dark Grey.
export const btn =
  "inline-flex h-6 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[14px] border-[.4px] border-rule bg-card px-[11.6px] text-fg shadow-figma hover:border-line active:bg-rule";
export const ghostBtn = `inline-flex cursor-pointer items-center gap-1 rounded px-1 text-muted hover:text-fg ${hoverRing} active:bg-rule active:shadow-figma`;
export const primaryBtn = "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-blue px-[18px] font-medium text-white hover:bg-[#0077d4]";
export const linkBtn = "inline-flex cursor-pointer items-center gap-1 text-muted hover:text-fg";
// the branch / read-only pills (6px padding per use)
export const badge = "rounded-xl border-[.4px] border-line font-light not-italic text-muted";
// Figma 129:1400: a tab's count, unboxed since the Nov 5 design
export const count = "rounded-xl px-[3px] font-light not-italic text-muted";
// Figma "Find a file": 28px, .4px Shadows stroke, 4px radius, the button shadow
export const field = "h-7 rounded border-[.4px] border-line bg-card px-3 shadow-figma";
export const fine = "my-2.5 text-[12.5px] leading-[1.5] text-faint";
// Figma 7:83: white, 12px radius, 24 / 20 padding, the button shadow (gap per use)
export const card = "flex flex-col rounded-xl bg-card px-5 py-6 shadow-figma";

// The avatar CDN by login: github.com/<login>.png is a redirect that intermittently 504s (avatars went missing at random)
export const Avatar = (props: { login: string; size: number }) => (
  <img
    class="shrink-0 rounded-full bg-bg2 align-middle"
    width={props.size}
    height={props.size}
    src={`https://avatars.githubusercontent.com/${encodeURIComponent(props.login)}?size=${props.size * 2}`}
    alt={props.login}
    title={props.login}
  />
);

// the Grandstander wordmark, outlined (Figma export): no web font for two words
export const Logo = () => (
  <a href="/" class="flex h-7 w-fit items-center">
    <img src={logoSvg} width={88} height={14} alt="Red Letter" />
  </a>
);

export const Spinner = () => <div class="size-4 animate-spin rounded-full border-2 border-line border-t-muted" />;

// Figma: "23 minutes ago"
export function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  const n = (v: number, unit: string) => `${v} ${unit}${v === 1 ? "" : "s"} ago`;
  if (s < 60) return "just now";
  if (s < 3600) return n(Math.floor(s / 60), "minute");
  if (s < 86400) return n(Math.floor(s / 3600), "hour");
  return new Date(iso).toLocaleDateString();
}

// Arrow keys in a list whose rows hold buttons or links (Up/Down, or Left/Right `across`; Home/End): focus moves to the
// next of the container's shown `items` (itself, if focusable, else the first button or link in it). Keys typed in a
// field are the field's.
export function listKeys(e: KeyboardEvent, items: string, across = false) {
  const [back, next] = across ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
  if (![back, next, "Home", "End"].includes(e.key) || e.altKey || e.ctrlKey || e.metaKey || (e.target as Element).matches("input, textarea, select")) return;
  // checkVisibility: rows in a closed <details> keep an offsetParent in Chrome (content-visibility: hidden)
  const list = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(items)].filter((el) => el.checkVisibility());
  const i = list.findIndex((el) => el.contains(document.activeElement));
  const to = e.key === "Home" ? list[0] : e.key === "End" ? list.at(-1) : list[i < 0 ? 0 : i + (e.key === next ? 1 : -1)];
  const target = to?.matches("a, button, summary, [tabindex]") ? to : to?.querySelector<HTMLElement>("a, button");
  if (!target) return;
  e.preventDefault();
  target.focus();
}

// Exported icons are dark fills drawn for a light background: inverted in dark mode. (Preflight makes <img> block.)
const Img = (props: { src: string; w: number; h?: number; class?: string }) => (
  <img class={`shrink-0 dark:invert ${props.class ?? ""}`} src={props.src} width={props.w} height={props.h ?? props.w} alt="" />
);
// Figma 140:2621 / 140:2645 "document 5/6": a panel drawn from two shapes, its bar wide while the panel is open and
// narrow once closed; `right` mirrors it for the comments panel (140:2607 / 140:2799)
export const SidebarIcon = (props: { closed: boolean; right?: boolean }) => (
  <span class={`relative grid size-[15px] shrink-0 place-items-center ${props.right ? "-scale-x-100" : ""}`}>
    <span class="h-[10.77px] w-[14px] rounded-[2px] border-[.8px] border-fg" />
    <span class={`absolute top-1/2 left-[1.67px] h-[8.97px] -translate-y-1/2 rounded-[1px] bg-fg ${props.closed ? "w-[2.33px]" : "w-[4.67px]"}`} />
  </span>
);
export const NewDocIcon = () => <Img src={createDocSvg} w={20} />;
// already light grey: no dark-mode inversion
export const SearchIcon = () => <img class="shrink-0" src={searchSvg} width={12} height={12} alt="" />;
// Figma 140:2690: the collapsed sidebar's search
export const FindIcon = () => <Img src={findSvg} w={15} />;
// Figma 129:1342: folder ("noun_File_7670746") and file ("document 5") icons share a 15px box
export const FolderIcon = () => <Img src={folderSvg} w={15} />;
export const FileIcon = () => <Img src={documentSvg} w={15} />;
// shown by the folder's <details> state: up = open, down = closed
export const ArrowUpIcon = () => <Img src={arrowUpSvg} w={8} class="hidden [details[open]>summary>&]:block" />;
export const ArrowDownIcon = () => <Img src={arrowDownSvg} w={8} class="[details[open]>summary>&]:hidden" />;
export const CommentIcon = () => <Img src={commentSvg} w={16} />;
export const TipArrow = () => <Img src={tipArrowSvg} w={10} h={8} />;
export const AtIcon = () => <Img src={atSignSvg} w={14} />;
export const EditIcon = () => <Img src={editSvg} w={15} />;
// Figma 129:1325's "document 6": the sidebar header's New file, edit.svg's pencil in Onyx
export const NewFileIcon = () => <Img src={newFileSvg} w={15} />;
// Figma 140:2835 / 140:2846: a tab's close and the tab strip's "+"
export const CloseIcon = () => <Img src={closeSvg} w={15} />;
export const PlusIcon = () => <Img src={plusSvg} w={15} />;
// Figma 140:2673: the header's "…"; 134:1701: its menu
export const DotsIcon = () => <Img src={dotsSvg} w={15} />;
export const LinkIcon = () => <Img src={linkSvg} w={15} />;
export const DuplicateIcon = () => <Img src={duplicateSvg} w={15} />;
export const CopyPageIcon = () => <Img src={copyPageSvg} w={15} />;
export const MoveIcon = () => <Img src={moveSvg} w={15} />;
export const DeleteIcon = () => <Img src={deleteSvg} w={15} />;
// Figma 129:1415: a comment's "…", in Shadows grey
export const CommentDotsIcon = () => <Img src={commentDotsSvg} w={20} />;
// Figma 180:123: the doc's reading / editing switch, both in Shadows grey (the chosen one sits on a grey square)
export const BookIcon = () => <Img src={bookSvg} w={15} />;
export const PencilIcon = () => <Img src={editSvg} w={15} />;
// Figma 180:386: where comments go. The pull request's side shows GitHub's outline mark while chosen, its grey filled
// mark otherwise.
export const GithubStrokeIcon = () => <Img src={githubStrokeSvg} w={15} />;
export const GithubMarkIcon = () => <Img src={githubMarkSvg} w={15} />;
// Figma 185:1581: the branch, in the file sidebar's bottom bar
export const BranchBarIcon = () => <Img src={branchSvg} w={15} />;

const Svg = (props: { size?: number; children: JSX.Element }) => (
  <svg width={props.size ?? 16} height={props.size ?? 16} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    {props.children}
  </svg>
);

export const CheckIcon = () => (
  <Svg size={14}>
    <path d="M3.5 8.5l3 3 6-7" />
  </Svg>
);
export const BranchIcon = () => (
  <Svg size={12}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="5.5" r="1.5" />
    <path d="M4.5 5v6M11.5 7c0 2.5-7 1.5-7 4" />
  </Svg>
);
// Figma 193:1989: History, a clock turning back (the panel tab's icon; was a branch until 2026-11-13)
export const HistoryIcon = () => (
  <svg width="15" height="15" viewBox="21.45 12.5 15 15" fill="currentColor" aria-hidden="true">
    <path d="M29.7703 14.2722C26.7938 14.277 24.3163 16.559 24.0671 19.5249L23.3378 18.7962C23.1285 18.5794 22.7833 18.5736 22.5665 18.7829C22.3497 18.9922 22.3439 19.3374 22.5532 19.5542C22.5575 19.5585 22.5623 19.5632 22.5665 19.5675L24.2029 21.2039C24.416 21.4169 24.7611 21.4169 24.9742 21.2039L26.6106 19.5675C26.8199 19.3507 26.814 19.0055 26.5972 18.7962C26.3858 18.5922 26.0507 18.5922 25.8393 18.7962L25.1665 19.469C25.4584 16.9239 27.7585 15.0969 30.3041 15.3887C32.8492 15.6806 34.6762 17.9807 34.3844 20.5263C34.0925 23.0709 31.7924 24.898 29.2473 24.6061C27.9263 24.4548 26.7336 23.7437 25.9724 22.6539C25.7934 22.4115 25.452 22.3599 25.2096 22.5388C24.9752 22.7114 24.9182 23.0379 25.0796 23.2803C26.8907 25.8728 30.4612 26.5067 33.0542 24.6951C35.6473 22.8835 36.2811 19.3129 34.4695 16.72C33.3972 15.1853 31.6427 14.2713 29.7703 14.2724L29.7703 14.2722ZM28.42 22.1211L30.1555 20.3856C30.2578 20.2834 30.3153 20.1449 30.3153 20V17.5454C30.3153 17.244 30.0714 17 29.7699 17C29.4684 17 29.2244 17.244 29.2244 17.5454V19.7742L27.6487 21.3498C27.4394 21.5666 27.4453 21.9118 27.6621 22.1211C27.8741 22.3252 28.2091 22.3251 28.42 22.1211Z" />
  </svg>
);
export const OutlineIcon = () => (
  <Svg size={12}>
    <path d="M2 3.5h12M5 8h9M8 12.5h6" />
  </Svg>
);
export const GithubMark = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);
