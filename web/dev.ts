// Local dev: rebuild on change, serve dist/ with the same SPA fallback as production (http://localhost:5173, or $PORT).
// The hub at localhost:8787 must be running (it allows this origin).
import { watch } from "node:fs";
import { build } from "./build.ts";

await build();
let timer: Timer | undefined;
watch(`${import.meta.dir}/src`, { recursive: true }, () => {
  clearTimeout(timer);
  timer = setTimeout(() => build().then(() => console.log("rebuilt"), (e) => console.error(e)), 100);
});

const dist = `${import.meta.dir}/dist`;
Bun.serve({
  port: Number(process.env.PORT) || 5173,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    const f = Bun.file(dist + pathname);
    if ((pathname.startsWith("/assets/") || pathname === "/sw.js") && (await f.exists())) return new Response(f);
    return new Response(Bun.file(`${dist}/index.html`), { headers: { "cache-control": "no-cache" } });
  },
});
console.log(`dev: http://localhost:${Number(process.env.PORT) || 5173}`);
