// Workspace commands: the ⌘K palette lists them all with their keys, and main.tsx runs the ones with keys from
// anywhere, the editor included. Keys are CodeMirror-style: "Mod" is ⌘ on a Mac and Ctrl elsewhere, "Alt" is ⌥.
import { doc, focusEditor, isReading, showTab, startComment, stepComment, toggleReading } from "../doc/docStore.ts";
import { pageItems } from "../doc/PageMenu.tsx";
import { activeTab, closeTab, navigateTo, repo, sameTab, showPanel, tabUrl, toggleFiles, togglePanel, toggleReview } from "../repo/repoStore.ts";
import { pulls, showView } from "../pulls/pullsStore.ts";

export type Command = { label: string; keys?: string; run: () => unknown };

const mac = /Mac|iP(hone|ad)/.test(navigator.platform);
const named: Record<string, string> = { BracketLeft: "[", BracketRight: "]", Backslash: "\\" };

// The pressed combination as a binding names it ("Mod-Shift-Alt-n"). The key is the character typed, unless ⌥ (on a
// Mac), Shift or a non-Latin layout changed it: then the physical key's US name, as CodeMirror does. AltGr typing a
// character (ń is AltGr+N in Polish) never matches a binding.
export function keysOf(e: KeyboardEvent): string {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const plain = /^[!-~]$/.test(k) && !(mac && e.altKey) && !e.shiftKey;
  const key = plain || (!mac && e.getModifierState("AltGraph")) ? k : /^(Key|Digit)./.test(e.code) ? e.code.slice(-1).toLowerCase() : (named[e.code] ?? k);
  const mods = [(mac ? e.metaKey : e.ctrlKey) && "Mod", mac && e.ctrlKey && "Ctrl", !mac && e.metaKey && "Meta", e.shiftKey && "Shift", e.altKey && "Alt"];
  return [...mods.filter(Boolean), key].join("-");
}

// "Mod-Shift-\\" → "⌘⇧\" on a Mac, "Ctrl+Shift+\" elsewhere
export function keyLabel(keys: string): string {
  const parts = keys.split(/-(?!$)/);
  const key = parts.pop()!.toUpperCase();
  if (mac) return parts.map((p) => ({ Mod: "⌘", Shift: "⇧", Alt: "⌥" })[p] ?? p).join("") + key;
  return [...parts.map((p) => (p === "Mod" ? "Ctrl" : p)), key].join("+");
}

// ---- moving focus between the workspace's areas: header, files, open tabs, the doc, the side panel ----
const shown = (el: Element | null): el is HTMLElement => el instanceof HTMLElement && el.checkVisibility();
const onDoc = () => !!doc.session && !repo.pull;

function showFiles() {
  if (repo.filesHidden) toggleFiles();
}

// the left sidebar's tab stop: the file tree's (FileSidebar keeps one) or the first pull request, else the search box
function focusFiles() {
  showFiles();
  const row = document.querySelector('#files [tabindex="0"]');
  (shown(row) ? row : document.querySelector<HTMLElement>("#files input"))?.focus();
}

// ⌘⇧E, VS Code's Explorer: the Files view (not Pull requests) with the open file's row focused, for the tree's keys;
// pressed again in the sidebar, back to the doc. Picking the view mounts the tree afresh: its rows are there the frame after.
function focusFileTree() {
  if (document.querySelector("#files")?.contains(document.activeElement)) return focusEditor();
  showFiles();
  showView("files");
  requestAnimationFrame(() => document.querySelector<HTMLElement>('#files [tabindex="0"]')?.focus());
}

// Into the side panel, where its keys work: the chosen tab's row to start from (the lit comment's card, else the
// first; the reader's section in the outline; the newest history row), else the tab itself. A panel just shown or a
// tab just picked mounts its rows the frame after.
export function focusPanel() {
  if (!onDoc()) return;
  showPanel();
  requestAnimationFrame(() => {
    const list = document.querySelector(`#${doc.tab}:not([hidden])`);
    const lit = doc.activeThread ? `[data-card="${CSS.escape(doc.activeThread)}"] button` : "";
    const order = { comments: [lit, "[data-card] button"], outline: ['[aria-current="location"]', "button"], history: ["li :is(button, a)"] }[doc.tab];
    const row = order.map((sel) => (sel && list?.querySelector(sel)) || null).find(shown);
    (row ?? document.querySelector<HTMLElement>('#panel [role="tab"][aria-selected="true"]'))?.focus();
  });
}
// ⌘⌥3 and ⌘⇧O: into the panel (⌘⇧O on the outline, VS Code's "go to symbol"); pressed again there, back to the doc
function togglePanelFocus(tab?: "outline") {
  if (document.querySelector("#panel")?.contains(document.activeElement)) return focusEditor();
  if (tab) showTab(tab);
  focusPanel();
}

const areas: [string, () => void][] = [
  ["header", () => document.querySelector<HTMLElement>("header :is(a, button, select)")?.focus()],
  ["#files", focusFiles],
  ["#tabs", () => document.querySelector<HTMLElement>('#tabs [aria-current="page"]')?.focus()],
  ["#doc", focusEditor],
  ["#panel", focusPanel],
];
// F6 / Shift-F6, as in browsers and desktop apps: the next area that's showing
function cycleArea(dir: 1 | -1) {
  const on = areas.filter(([sel]) => shown(document.querySelector(sel)));
  const i = on.findIndex(([sel]) => document.querySelector(sel)!.contains(document.activeElement));
  on[i < 0 ? (dir > 0 ? 0 : on.length - 1) : (i + dir + on.length) % on.length]?.[1]();
}

function stepTab(dir: 1 | -1) {
  const n = repo.tabs.length, i = repo.tabs.findIndex((t) => sameTab(t, activeTab()));
  if (i < 0 || n < 2) return;
  navigateTo(tabUrl(repo.repo!.full_name, repo.tabs[(i + dir + n) % n]!));
}

// the branch picker at the file sidebar's foot (BranchBar), opened
function pickBranch() {
  showFiles();
  const sel = document.querySelector<HTMLSelectElement>('#files select[aria-label="Branch"]');
  sel?.focus();
  try {
    sel?.showPicker();
  } catch {} // browsers without showPicker on <select>: focused, arrows switch
}

export const commands = (): Command[] => [
  { label: "Comment on selection", keys: "Mod-Alt-m", run: startComment },
  { label: "Next comment", keys: "Mod-Alt-n", run: () => (showPanel(), stepComment(1)) },
  { label: "Previous comment", keys: "Mod-Alt-p", run: () => (showPanel(), stepComment(-1)) },
  { label: "Go to files", keys: "Mod-Alt-1", run: focusFiles },
  { label: "File tree / back to the doc", keys: "Mod-Shift-e", run: focusFileTree },
  { label: "Go to the doc", keys: "Mod-Alt-2", run: focusEditor },
  { label: "Side panel / back to the doc", keys: "Mod-Alt-3", run: () => togglePanelFocus() },
  { label: "Outline / back to the doc", keys: "Mod-Shift-o", run: () => togglePanelFocus("outline") },
  { label: "Next area", keys: "F6", run: () => cycleArea(1) },
  { label: "Previous area", keys: "Shift-F6", run: () => cycleArea(-1) },
  { label: "Next tab", keys: "Mod-Alt-]", run: () => stepTab(1) },
  { label: "Previous tab", keys: "Mod-Alt-[", run: () => stepTab(-1) },
  ...(repo.tabs.length > 1 ? [{ label: "Close tab", run: () => closeTab(activeTab()) }] : []),
  { label: "Show comments", run: () => (showTab("comments"), showPanel()) },
  { label: "Show history", run: () => (showTab("history"), showPanel()) },
  { label: "Show outline", run: () => (showTab("outline"), showPanel()) },
  { label: "Show pull requests", run: () => (showFiles(), showView("pulls")) },
  ...(pulls.reviewing ? [{ label: `Stop reviewing #${pulls.reviewing.number}`, run: toggleReview }] : doc.pr ? [{ label: `Review pull request #${doc.pr.number}`, run: toggleReview }] : []),
  { label: repo.filesHidden ? "Show files" : "Hide files", keys: "Mod-\\", run: toggleFiles },
  { label: repo.panelHidden ? "Show side panel" : "Hide side panel", keys: "Mod-Shift-\\", run: togglePanel },
  ...(doc.session ? [{ label: "Save", keys: "Mod-s", run: () => doc.session?.save() }] : []),
  ...(doc.session?.canWrite ? [{ label: isReading() ? "Switch to editing" : "Switch to reading", run: toggleReading }] : []),
  { label: "Switch branch", run: pickBranch },
  ...(onDoc() ? pageItems(doc.session!.canWrite) : []),
];

// main.tsx's keydown: run the command bound to these keys; false when none is
export function runKeys(keys: string): boolean {
  const c = commands().find((c) => c.keys === keys);
  if (c) void c.run();
  return !!c;
}
