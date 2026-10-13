// Automerge is aliased to its /slim build (see build.ts): load the wasm as a cacheable file, then start the app.
// Nothing may call Automerge at module load; app.ts does all work inside start().
import { initializeWasm } from "@automerge/automerge";
import wasmUrl from "@automerge/automerge/automerge.wasm" with { type: "file" };
import { start } from "./app.ts";

await initializeWasm(wasmUrl);
start();
