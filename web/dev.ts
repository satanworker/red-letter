// Local dev: rebuild on change, serve dist/ with the same SPA fallback as production (http://localhost:5173, or $PORT).
// The hub at localhost:8787 must be running (it allows this origin).
import { watch } from "node:fs";
import { build } from "./build.ts";

await build();
// One build at a time: a build empties dist/ first, so a second one started meanwhile (edits to several files) pulled
// files out from under the first and took the server down. Changes during a build get one more build after it.
let timer: Timer | undefined;
let building: Promise<void> | null = null;
let again = false;
function rebuild() {
  if (building) return void (again = true);
  building = build()
    .then(() => console.log("rebuilt"), (e) => console.error(e))
    .finally(() => {
      building = null;
      if (again) (again = false), rebuild();
    });
}
watch(`${import.meta.dir}/src`, { recursive: true }, () => {
  clearTimeout(timer);
  timer = setTimeout(rebuild, 100);
});

const dist = `${import.meta.dir}/dist`;
Bun.serve({
  port: Number(process.env.PORT) || 5173,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    const f = Bun.file(dist + pathname);
    if ((pathname.startsWith("/assets/") || pathname === "/sw.js") && (await f.exists())) return new Response(f);
    // Figma reference renders for the /__figma page; never part of a build
    const dev = Bun.file(`${import.meta.dir}${pathname}`);
    if (pathname.startsWith("/dev/") && (await dev.exists())) return new Response(dev);
    return new Response(Bun.file(`${dist}/index.html`), { headers: { "cache-control": "no-cache" } });
  },
});
console.log(`dev: http://localhost:${Number(process.env.PORT) || 5173}`);
