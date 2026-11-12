// Automerge is aliased to its /slim build (see build.ts): load the wasm as a cacheable file, then start the app.
// Nothing may call Automerge at module load. Global listeners live here and only dispatch store actions.
import { initializeWasm } from "@automerge/automerge";
import wasmUrl from "@automerge/automerge/automerge.wasm" with { type: "file" };
import { render } from "solid-js/web";
import { App } from "./App.tsx";
import "./app.css";
import { comments } from "./comments/commentsStore.ts";
import { doc, editorView, leavingWithUnsaved, tick } from "./doc/docStore.ts";
import { showFigmaFixture } from "./dev/figma.tsx";
import { openInBackground, openRoute, repo } from "./repo/repoStore.ts";
import { palette, togglePalette } from "./palette/paletteStore.ts";
import { keysOf, runKeys } from "./palette/commands.ts";
import { rate } from "./rate.ts";

await initializeWasm(wasmUrl);
render(() => <App />, document.getElementById("app")!);

// Same-document navigation: links, back/forward and navigateTo() switch files without reloading the page.
// The OAuth callback stays a page load: it's where GitHub sends the browser.
window.navigation?.addEventListener("navigate", (e) => {
  const url = new URL(e.destination.url);
  if (!e.canIntercept || e.hashChange || e.downloadRequest !== null || url.pathname === "/auth/callback") return;
  e.intercept({ handler: () => openRoute(url) });
});
// ⌘/Ctrl+click on a link into a repo: a background tab here, not a new browser tab. A plain click opens its tab.
addEventListener("click", (e) => {
  const a = e.target instanceof Element ? e.target.closest("a") : null;
  if (!(e.metaKey || e.ctrlKey) || !a || a.target || a.origin !== location.origin || !window.navigation || repo.screen !== "workspace") return;
  if (a.pathname.split("/").filter(Boolean).length < 2) return; // the logo: the landing page has no tabs
  e.preventDefault();
  openInBackground(a.pathname);
});
// /__figma: dev page comparing the editor with the Figma design (src/dev/figma.tsx); /__stress: a huge doc for
// web/bench/stress.ts (src/dev/stress.ts, its own chunk)
if (location.pathname === "/__figma") showFigmaFixture();
else if (location.pathname === "/__stress") void import("./dev/stress.ts").then((m) => m.showStress());
else void openRoute(new URL(location.href));

addEventListener("focus", () => tick());
// The workspace's keys (palette/commands.ts), from anywhere: captured before the editor, which would otherwise take
// them. While the palette is open only ⌘K (closing it) is global; its other keys are its own.
addEventListener(
  "keydown",
  (e) => {
    if (repo.screen !== "workspace" || !(e.ctrlKey || e.metaKey || e.altKey || e.key === "F6")) return; // typing: none of ours
    const keys = keysOf(e);
    if (keys === "Mod-k") togglePalette();
    else if (palette.open || !runKeys(keys)) return;
    e.preventDefault();
    e.stopPropagation();
  },
  { capture: true },
);
addEventListener("online", () => tick(true)); // queued comments and failed saves go out as soon as the network is back
addEventListener("visibilitychange", () => !document.hidden && tick()); // a hidden tab stops polling; shown again, it catches up
addEventListener("beforeunload", (e) => {
  if (leavingWithUnsaved()) e.preventDefault();
});
if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js");

Object.assign(window, { rl: { doc, repo, comments, rate, editorView } }); // console debugging and smoke tests: rl.doc.session, rl.repo.docs, rl.rate, rl.editorView()