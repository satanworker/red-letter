// /__figma (dev only): the editor screen showing exactly what Figma "Red Letter" › Desktop - 1 (node 1:8) shows, with
// the Figma render laid over it. View at 1440×900. Alt+O overlay on/off · Alt+D difference ↔ 50% fade (or click the bar).
// The renders live in web/dev/ and are served by dev.ts only, so production builds carry none of it.
import { Repo } from "@automerge/automerge-repo";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { fixtureComments } from "../comments/commentsStore.ts";
import type { Comment } from "../comments/commentsService.ts";
import { fixtureDoc } from "../doc/docStore.ts";
import type { AgentMark, RLDoc, Session } from "../doc/session.ts";
import { fixtureRepo } from "../repo/repoStore.ts";

const sentence = "Git is canonical. The CRDT is the live working copy of one file on one branch.";
const TEXT = `# Red Letter — design sketch


Share a link to a file in a GitHub repo. Anyone with access signs in with GitHub, reads it, edits it live with others, comments in the margin. Agents keep using plain git. The file stays vanilla markdown.

Red-letter Bibles print the important words in red on top of the plain text: an annotation layer over a canonical text. Same idea.

## Red Letter — design sketch

${sentence} Git conflicts become CRDT merges.

## Topology (no stateful server)

![architecture](diagrams/architecture.svg)

${sentence} Git conflicts become CRDT merges.
`;

const DOCS = [
  "docs/DESIGN.md",
  ...["crdt-choice", "crdts-in-production", "github-integration", "markdown-editors", "prior-art-patchwork-git-bridges", "prior-products"].map((f) => `docs/research/${f}.md`),
  "experiments/RESULTS.md",
  "experiments/github/FINDING.md",
  "demo.md",
];

export function showFigmaFixture() {
  const at = new Date(Date.now() - 23 * 60_000).toISOString();
  const body = "I’m not sure we need to street it. Maybe lets try another way";
  const msg = (id: string, parent?: string): Comment => ({ id, parent, author: "Satanworker", body, createdAt: at, ...(parent ? {} : { quote: sentence }) });
  // the design's agent tab shows 10
  const marks: Record<string, AgentMark> = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`fixture${i}`, { sha: `fixture${i}`, author: "agent", message: "edit", at, hunks: [], conflicts: [] }]),
  );
  const handle = new Repo({ network: [] }).create<RLDoc>({ text: TEXT, marks });
  const session = {
    repoName: "satanworker/red-letter",
    branch: "demo",
    path: "demo.md",
    canWrite: true,
    handle,
    get doc() {
      return handle.doc()!;
    },
    get docId() {
      return handle.documentId;
    },
    resolve: () => null,
    imageUrl: async (src: string) => (src === "diagrams/architecture.svg" ? "/dev/architecture.png" : null),
    poll: async () => {},
    anchor: () => ({ from: "", to: "" }), // threads fall back to their quote
    save: async () => {},
    close: () => {},
  } as unknown as Session;

  fixtureRepo({
    screen: "workspace",
    user: { login: "satanworker", avatar_url: "" },
    owner: "satanworker",
    name: "red-letter",
    repo: { node_id: "", full_name: "Satanworker/red-letter", default_branch: "main", permissions: { push: true } },
    branch: "demo",
    docs: DOCS,
    path: "demo.md",
    filesHidden: false,
  });
  fixtureComments([msg("t1"), msg("t1a", "t1"), msg("t1b", "t1"), msg("t2")], "demo/demo.md.json");
  fixtureDoc({
    session,
    login: "satanworker",
    status: { saving: false, dirty: false, commit: "9d164de52712fd3d5373d4f8ae31e3de0b80ad35", people: [], online: true, baseHead: "" },
    panel: true,
    tab: "comments",
  });

  // The design's UI state: docs, experiments and experiments/github open; the first "Git is canonical…" sentence selected.
  requestAnimationFrame(() => {
    for (const s of document.querySelectorAll<HTMLElement>("#files summary")) {
      const d = s.parentElement as HTMLDetailsElement;
      d.open = ["docs", "experiments", "github"].includes(s.textContent!.trim());
    }
    const line = [...document.querySelectorAll(".cm-line")].find((l) => l.textContent!.startsWith(sentence));
    const text = line && document.createTreeWalker(line, NodeFilter.SHOW_TEXT).nextNode();
    if (!text) return;
    document.querySelector<HTMLElement>(".cm-content")!.focus();
    getSelection()!.setBaseAndExtent(text, 0, text, sentence.length);
  });

  const host = document.body.appendChild(document.createElement("div"));
  render(() => <Overlay />, host);
}

// The Figma reference: the full frame (1024 px wide, scaled up) under exact 1× renders of the doc, sidebar and panel.
function Overlay() {
  const [on, setOn] = createSignal(true);
  const [diff, setDiff] = createSignal(true);
  // Alt: plain letters would type into the focused editor
  addEventListener("keydown", (e) => {
    if (!e.altKey) return;
    if (e.code === "KeyO") setOn((v) => !v);
    else if (e.code === "KeyD") setDiff((v) => !v);
    else return;
    e.preventDefault();
  });
  const layer = (src: string, x: number, y: number, w: number, h: number) => (
    <img src={src} alt="" class="absolute max-w-none" style={{ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` }} />
  );
  return (
    <>
      <div
        hidden={!on()}
        class="pointer-events-none fixed top-0 left-0 z-[100] h-[900px] w-[1440px] overflow-hidden"
        style={{ "mix-blend-mode": diff() ? "difference" : "normal", opacity: diff() ? 1 : 0.5 }}
      >
        {layer("/dev/figma-frame-1024.png", 0, 0, 1440, 900)}
        {layer("/dev/figma-sidebar.png", 0, 35, 327, 866)}
        {layer("/dev/figma-doc.png", 320, 35, 800, 865)}
        {layer("/dev/figma-panel.png", 1120, 35, 321, 866)}
      </div>
      <div class="fixed bottom-2 left-1/2 z-[101] flex -translate-x-1/2 items-center gap-2 rounded-lg bg-card px-3 py-1.5 text-muted shadow-pop">
        Figma overlay
        <button id="figma-on" class="cursor-pointer underline" onMouseDown={(e) => e.preventDefault()} onClick={() => setOn((v) => !v)}>
          {on() ? "on" : "off"} (Alt+O)
        </button>
        <button id="figma-mode" class="cursor-pointer underline" onMouseDown={(e) => e.preventDefault()} onClick={() => setDiff((v) => !v)}>
          {diff() ? "difference" : "50%"} (Alt+D)
        </button>
      </div>
    </>
  );
}
