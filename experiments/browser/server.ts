// Smoke-test infra: static page (bundled on start) + automerge-repo websocket relay with no storage.
import { Repo } from "@automerge/automerge-repo";
import { NodeWSServerAdapter } from "@automerge/automerge-repo-network-websocket";
import { WebSocketServer } from "ws";

// "webpack" condition -> automerge's fullfat_base64 entry (wasm inlined); Bun can't bundle the ESM-wasm "browser" entry.
const build = await Bun.build({ entrypoints: [`${import.meta.dir}/app.ts`], target: "browser", conditions: ["webpack"] });
if (!build.success) throw new AggregateError(build.logs, "bundle failed");
const bundle = await build.outputs[0].text();

// Relay: an in-memory peer that forwards sync messages. Nothing is persisted; restart = empty.
const wss = new WebSocketServer({ port: 3030 });
new Repo({ network: [new NodeWSServerAdapter(wss)], sharePolicy: async () => true });

Bun.serve({
  port: 5173,
  fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === "/app.js") return new Response(bundle, { headers: { "content-type": "text/javascript" } });
    return new Response(Bun.file(`${import.meta.dir}/index.html`));
  },
});
console.log("ready: page http://localhost:5173  relay ws://localhost:3030");
