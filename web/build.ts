// Bundle web/src into dist/: index.html, hashed /assets/* (JS chunks, the Tailwind CSS, automerge.wasm as a separate
// cacheable file) and /sw.js, which precaches exactly this build's assets.
import { SolidPlugin } from "@dschz/bun-plugin-solid";
import tailwind from "bun-plugin-tailwind";
import { rmSync } from "node:fs";

const nm = `${import.meta.dir}/node_modules/@automerge`;
// Every "@automerge/automerge(-repo)" import -> its /slim entry, so the wasm isn't inlined as base64 (+3.6 MB JS);
// main.tsx initializes it from the .wasm file instead.
const slim: Record<string, string> = {
  "@automerge/automerge": `${nm}/automerge/dist/mjs/entrypoints/slim.js`,
  "@automerge/automerge-repo": `${nm}/automerge-repo/dist/entrypoints/slim.js`,
};

// out: where the site goes (bench/stress.ts builds one of its own)
export async function build(out = `${import.meta.dir}/dist`) {
  rmSync(out, { recursive: true, force: true });
  const minify = !process.env.NO_MINIFY; // NO_MINIFY=1: readable function names in CPU profiles (bench/stress.ts --profile)
  const naming = { entry: "[name]-[hash].[ext]", chunk: "[name]-[hash].[ext]", asset: "[name]-[hash].[ext]" };
  // the mermaid worker is a script of its own; the app gets its URL
  const worker = await Bun.build({ entrypoints: [`${import.meta.dir}/src/doc/mermaid.worker.ts`], outdir: `${out}/assets`, target: "browser", minify, naming });
  if (!worker.success) throw new AggregateError(worker.logs, "mermaid worker bundle failed");
  const res = await Bun.build({
    entrypoints: [`${import.meta.dir}/src/main.tsx`],
    outdir: `${out}/assets`,
    target: "browser",
    conditions: ["browser"], // solid-js's DOM build, not its server build
    minify,
    splitting: true,
    sourcemap: "linked", // bug reports' stack traces and slow-frame scripts point into minified code: the maps decode them
    naming,
    publicPath: "/assets/",
    define: {
      MERMAID_WORKER: JSON.stringify(`/assets/${worker.outputs[0]!.path.split("/").pop()}`),
      // Bun resolves the "development" export condition unless NODE_ENV is production, so the site shipped Solid's dev
      // build (devtools graph, dev warnings, extra checks on every signal write). This picks solid.js and strips other
      // packages' dev branches.
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    plugins: [
      { name: "automerge-slim", setup: (b) => b.onResolve({ filter: /^@automerge\/automerge(-repo)?$/ }, (a) => ({ path: slim[a.path] })) },
      SolidPlugin({ generate: "dom", hydratable: false, sourceMaps: false }),
      tailwind,
    ],
  });
  if (!res.success) throw new AggregateError(res.logs, "bundle failed");
  const entry = res.outputs.find((o) => o.kind === "entry-point")!;
  const css = res.outputs.filter((o) => o.path.endsWith(".css")).map((o) => `<link rel="stylesheet" href="/assets/${o.path.split("/").pop()}">`);
  const html = (await Bun.file(`${import.meta.dir}/index.html`).text())
    .replace("%CSS%", css.join("\n"))
    .replace("%ENTRY%", `/assets/${entry.path.split("/").pop()}`);
  await Bun.write(`${out}/index.html`, html);
  await Bun.write(`${out}/_headers`, "/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n");

  const outputs = [...res.outputs, ...worker.outputs];
  // source maps load only with DevTools open (or for decoding a report): not precached
  const assets = outputs.filter((o) => !o.path.endsWith(".map")).map((o) => `/assets/${o.path.split("/").pop()}`);
  const sw = await Bun.build({
    entrypoints: [`${import.meta.dir}/src/sw.ts`],
    target: "browser",
    minify: true,
    define: { ASSETS: JSON.stringify(assets), VERSION: JSON.stringify(Bun.hash(assets.join()).toString(36)) },
  });
  if (!sw.success) throw new AggregateError(sw.logs, "service worker bundle failed");
  await Bun.write(`${out}/sw.js`, sw.outputs[0]);
  return outputs.map((o) => `${o.path.slice(out.length)} ${(o.size / 1024).toFixed(0)}K`);
}

if (import.meta.main) console.log((await build()).join("\n"));
