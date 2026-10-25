// Small shared pieces: avatars, icons, the logo, relative times, and the class strings every screen reuses.
// Design icons are the SVGs exported from Figma (src/icons/); the few the design lacks stay inline SVG (currentColor).
import type { JSX } from "solid-js";
import arrowDownSvg from "./icons/arrow-down.svg";
import arrowUpSvg from "./icons/arrow-up.svg";
import commentSvg from "./icons/comment.svg";
import createDocSvg from "./icons/create-doc.svg";
import documentSvg from "./icons/document.svg";
import folderSvg from "./icons/folder.svg";
import robotSvg from "./icons/robot.svg";
import searchSvg from "./icons/search.svg";
import sidebarSvg from "./icons/sidebar.svg";
import tipArrowSvg from "./icons/tip-arrow.svg";
import atSignSvg from "./icons/at-sign.svg";
import sendSvg from "./icons/send.svg";

// Figma "Reply"/"Resolve": 24px tall, width = text + 24 with the .4px stroke inside.
export const btn =
  "inline-flex h-6 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[14px] border-[.4px] border-rule bg-card px-[11.6px] text-fg shadow-figma hover:bg-hover";
export const ghostBtn = "inline-flex cursor-pointer items-center gap-1 rounded px-1 text-muted hover:bg-hover hover:text-fg";
export const primaryBtn = "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-blue px-[18px] font-medium text-white hover:bg-[#0077d4]";
export const linkBtn = "inline-flex cursor-pointer items-center gap-1 text-muted hover:text-fg";
// padding per use: Figma count badges are 3px, the branch / read-only pills 6px
export const badge = "rounded-xl border-[.4px] border-line font-light not-italic text-muted";
// Figma "Find a file": 28px, .4px Shadows stroke, 4px radius, the button shadow
export const field = "h-7 rounded border-[.4px] border-line bg-card px-3 shadow-figma";
export const fine = "my-2.5 text-[12.5px] leading-[1.5] text-faint";
// Figma 7:83: white, 12px radius, 24 / 20 padding, the button shadow (gap per use)
export const card = "flex flex-col rounded-xl bg-card px-5 py-6 shadow-figma";

export const Avatar = (props: { login: string; size: number }) => (
  <img
    class="shrink-0 rounded-full bg-bg2 align-middle"
    width={props.size}
    height={props.size}
    src={`https://github.com/${encodeURIComponent(props.login)}.png?size=${props.size * 2}`}
    alt={props.login}
    title={props.login}
  />
);

// Git commit authors are names, not GitHub logins: show an initial instead of guessing an avatar.
export const Initial = (props: { name: string; size: number }) => (
  <span
    class="inline-flex shrink-0 items-center justify-center rounded-full bg-av-bg font-semibold text-av-fg"
    style={{ width: `${props.size}px`, height: `${props.size}px`, "font-size": `${Math.round(props.size * 0.5)}px` }}
    title={props.name}
  >
    {(props.name.trim()[0] ?? "?").toUpperCase()}
  </span>
);

export const Logo = () => (
  <a href="/" class="font-logo text-[18px] leading-7 text-brand">
    Red Letter
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
export const SidebarIcon = () => <Img src={sidebarSvg} w={20} />;
export const NewDocIcon = () => <Img src={createDocSvg} w={20} />;
// already light grey: no dark-mode inversion
export const SearchIcon = () => <img class="shrink-0" src={searchSvg} width={12} height={12} alt="" />;
export const FolderIcon = () => <Img src={folderSvg} w={15} />;
export const FileIcon = () => <Img src={documentSvg} w={10} h={13} />;
// shown by the folder's <details> state: up = open, down = closed
export const ArrowUpIcon = () => <Img src={arrowUpSvg} w={8} class="hidden [details[open]>summary>&]:block" />;
export const ArrowDownIcon = () => <Img src={arrowDownSvg} w={8} class="[details[open]>summary>&]:hidden" />;
export const CommentIcon = () => <Img src={commentSvg} w={16} />;
// Figma's robot frame is 14px with the glyph inset 4.46% / 8% / 3.47% / 8%
export const RobotIcon = () => <Img src={robotSvg} w={14} class="p-[.624px_1.12px_.486px]" />;
export const TipArrow = () => <Img src={tipArrowSvg} w={10} h={8} />;
export const AtIcon = () => <Img src={atSignSvg} w={12} />;
// a coloured disc: same in dark mode
export const SendIcon = () => <img class="shrink-0" src={sendSvg} width={20} height={20} alt="" />;

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
export const GithubMark = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);
