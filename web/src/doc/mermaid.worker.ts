// Renders ```mermaid diagrams off the main thread (mermaid.ts posts sources here): ELK layout takes 20-70 ms a
// diagram, and a screenful of new diagrams rendered on the main thread stalled scrolling and typing for 250 ms.
// Built on its own by build.ts (MERMAID_WORKER is its URL).
import { renderMermaidSVG } from "beautiful-mermaid";

export type Request = { id: number; src: string; options: Parameters<typeof renderMermaidSVG>[1] };
export type Reply = { id: number; svg: string } | { id: number; error: string };

// elkjs (beautiful-mermaid's layout) decides it is running as its own worker script when there is a `self` and no
// `document`, takes over onmessage and leaves the layout class undefined ("… is not a constructor"); beautiful-mermaid
// works around that on a page by deleting `self` for a moment and assigning it back, which a worker's getter-only
// `self` refuses. A `document` keeps elkjs on its in-thread path and a plain `self` takes the assignment. Nothing reads
// either: neither library touches the DOM.
Object.defineProperty(globalThis, "self", { value: globalThis, writable: true, configurable: true });
Object.assign(globalThis, { document: {} });

onmessage = (e: MessageEvent<Request>) => {
  const { id, src, options } = e.data;
  let reply: Reply;
  try {
    reply = { id, svg: renderMermaidSVG(src, options) };
  } catch (err) {
    reply = { id, error: err instanceof Error ? err.message : String(err) };
  }
  postMessage(reply);
};
