// Bundle web/src into dist/: index.html, hashed /assets/* (JS chunks, automerge.wasm as a separate cacheable file)
// and /sw.js, which precaches exactly this build's assets.
import { SolidPlugin } from "@dschz/bun-plugin-solid";
import { rmSync } from "node:fs";

const nm = `${import.meta.dir}/node_modules/@automerge`;
// Every "@automerge/automerge(-repo)" import -> its /slim entry, so the wasm isn't inlined as base64 (+3.6 MB JS);
// main.tsx initializes it from the .wasm file instead.
const slim: Record<string, string> = {
  "@automerge/automerge": `${nm}/automerge/dist/mjs/entrypoints/slim.js`,
  "@automerge/automerge-repo": `${nm}/automerge-repo/dist/entrypoints/slim.js`,
};

export async function build() {
  const out = `${import.meta.dir}/dist`;
  rmSync(out, { recursive: true, force: true });
  const res = await Bun.build({
    entrypoints: [`${import.meta.dir}/src/main.tsx`],
    outdir: `${out}/assets`,
    target: "browser",
    conditions: ["browser"], // solid-js's DOM build, not its server build
    minify: true,
    splitting: true,
    sourcemap: "none",
    naming: { entry: "[name]-[hash].[ext]", chunk: "[name]-[hash].[ext]", asset: "[name]-[hash].[ext]" },
    publicPath: "/assets/",
    plugins: [
      { name: "automerge-slim", setup: (b) => b.onResolve({ filter: /^@automerge\/automerge(-repo)?$/ }, (a) => ({ path: slim[a.path] })) },
      SolidPlugin({ generate: "dom", hydratable: false, sourceMaps: false }),
    ],
  });
  if (!res.success) throw new AggregateError(res.logs, "bundle failed");
  const entry = res.outputs.find((o) => o.kind === "entry-point")!;
  const html = (await Bun.file(`${import.meta.dir}/index.html`).text()).replace("%ENTRY%", `/assets/${entry.path.split("/").pop()}`);
  await Bun.write(`${out}/index.html`, html);
  await Bun.write(`${out}/_headers`, "/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n");

  const assets = res.outputs.map((o) => `/assets/${o.path.split("/").pop()}`);
  const sw = await Bun.build({
    entrypoints: [`${import.meta.dir}/src/sw.ts`],
    target: "browser",
    minify: true,
    define: { ASSETS: JSON.stringify(assets), VERSION: JSON.stringify(Bun.hash(assets.join()).toString(36)) },
  });
  if (!sw.success) throw new AggregateError(sw.logs, "service worker bundle failed");
  await Bun.write(`${out}/sw.js`, sw.outputs[0]);
  return res.outputs.map((o) => `${o.path.slice(out.length)} ${(o.size / 1024).toFixed(0)}K`);
}

if (import.meta.main) console.log((await build()).join("\n"));
