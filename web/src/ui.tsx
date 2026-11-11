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
import linkSvg from "./icons/link.svg";
import duplicateSvg from "./icons/duplicate.svg";
import copyPageSvg from "./icons/copy-page.svg";
import moveSvg from "./icons/move.svg";
import deleteSvg from "./icons/delete.svg";
import logoSvg from "./icons/logo.svg";

// Figma "Reply"/"Resolve": 24px tall, width = text + 24 with the .4px stroke inside.
export const btn =
  "inline-flex h-6 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[14px] border-[.4px] border-rule bg-card px-[11.6px] text-fg shadow-figma hover:bg-hover";
export const ghostBtn = "inline-flex cursor-pointer items-center gap-1 rounded px-1 text-muted hover:bg-hover hover:text-fg";
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
