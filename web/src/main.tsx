// Automerge is aliased to its /slim build (see build.ts): load the wasm as a cacheable file, then start the app.
// Nothing may call Automerge at module load. Global listeners live here and only dispatch store actions.
import { initializeWasm } from "@automerge/automerge";
import wasmUrl from "@automerge/automerge/automerge.wasm" with { type: "file" };
import { render } from "solid-js/web";
import { App } from "./App.tsx";
import { comments } from "./comments/commentsStore.ts";
import { doc, leavingWithUnsaved, tick } from "./doc/docStore.ts";
import { openRoute, repo } from "./repo/repoStore.ts";

await initializeWasm(wasmUrl);
render(() => <App />, document.getElementById("app")!);

// Same-document navigation: links, back/forward and navigateTo() switch files without reloading the page.
// The OAuth callback stays a page load: it's where GitHub sends the browser.
window.navigation?.addEventListener("navigate", (e) => {
  const url = new URL(e.destination.url);
  if (!e.canIntercept || e.hashChange || e.downloadRequest !== null || url.pathname === "/auth/callback") return;
  e.intercept({ handler: () => openRoute(url) });
});
void openRoute(new URL(location.href));

addEventListener("focus", tick);
addEventListener("beforeunload", (e) => {
  if (leavingWithUnsaved()) e.preventDefault();
});
if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js");

Object.assign(window, { rl: { doc, repo, comments } }); // console debugging and smoke tests: rl.doc.session, rl.repo.docs