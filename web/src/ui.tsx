// Small shared pieces: avatars, icons, the logo, relative times.
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

export const Avatar = (props: { login: string; size: number }) => (
  <img
    class="av"
    width={props.size}
    height={props.size}
    src={`https://github.com/${encodeURIComponent(props.login)}.png?size=${props.size * 2}`}
    alt={props.login}
    title={props.login}
  />
);

// Git commit authors are names, not GitHub logins: show an initial instead of guessing an avatar.
export const Initial = (props: { name: string; size: number }) => (
  <span class="av initial" style={{ width: `${props.size}px`, height: `${props.size}px`, "font-size": `${Math.round(props.size * 0.5)}px` }} title={props.name}>
    {(props.name.trim()[0] ?? "?").toUpperCase()}
  </span>
);

export const Logo = () => (
  <a href="/" class="logo">
    Red Letter
  </a>
);

export function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

const Img = (props: { src: string; w: number; h?: number; class?: string }) => (
  <img class={props.class ? `ic ${props.class}` : "ic"} src={props.src} width={props.w} height={props.h ?? props.w} alt="" />
);
export const SidebarIcon = () => <Img src={sidebarSvg} w={20} />;
export const NewDocIcon = () => <Img src={createDocSvg} w={20} />;
export const SearchIcon = () => <Img src={searchSvg} w={12} />;
export const FolderIcon = () => <Img src={folderSvg} w={15} />;
export const FileIcon = () => <Img src={documentSvg} w={10} h={13} />;
export const ArrowUpIcon = (props: { class?: string }) => <Img src={arrowUpSvg} w={8} class={props.class} />;
export const ArrowDownIcon = (props: { class?: string }) => <Img src={arrowDownSvg} w={8} class={props.class} />;
export const CommentIcon = () => <Img src={commentSvg} w={16} />;
export const RobotIcon = () => <Img src={robotSvg} w={14} class="robot" />;
export const TipArrow = () => <Img src={tipArrowSvg} w={10} h={8} />;

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
