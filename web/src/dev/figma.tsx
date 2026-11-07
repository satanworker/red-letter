// /__figma (dev only): the editor screen showing exactly what Figma "Red Letter" › RED LETTER 5 NOV (node 129:1304)
// shows, with the Figma render laid over it. View at 1440×900. Alt+O overlay on/off · Alt+D difference ↔ 50% fade (or click the bar).
// The renders live in web/dev/ and are served by dev.ts only, so production builds carry none of it.
import { Repo } from "@automerge/automerge-repo";
import { EditorView } from "@codemirror/view";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { docChanged, fixtureDoc, startComment } from "../doc/docStore.ts";
import type { AgentMark, RLDoc, Session } from "../doc/session.ts";
import { fixtureRepo } from "../repo/repoStore.ts";

const sentence = "Git is canonical. The CRDT is the live working copy of one file on one branch.";
const TEXT = `# GitHub integration (2025–2026): auth, commits, webhooks

Observed from GitHub docs (\`X-GitHub-Api-Version: 2026-03-10\`) unless marked \`[INFERENCE]\`.

## 1. Auth: use a GitHub App (not OAuth App, not PAT)

GitHub prefers Apps: fine-grained perms, short-lived tokens, one webhook for every installed repo, rate limits that scale. OAuth Apps use broad scopes, always act as the user, and need per-repo webhooks that are not cleaned up on revoke. Fine-grained PATs are for a person/script (max 50/user, one owner, org approval); they die if the user loses access. Classic PATs are worse (\`repo\` = every repo).

**Two tokens, one App:**

> <!--rl:t1--><!--rl:t2-->${sentence}<!--/rl:t2--><!--/rl:t1-->

![architecture](diagrams/architecture.svg)

Do **not** use the installation token for user saves: it can write any installed repo even if that user cannot. Check access with \`GET /user/installations\` and \`GET /user/installations/{id}/repositories\`.

**App perms:** Contents R/W, Pull requests W, Metadata R. Account: Email addresses R (for trailers). Events: \`push\`, \`installation\`, \`github_app_authorization\` (cannot unsubscribe; stop using revoked tokens).

Turn on **Request user authorization (OAuth) during installation**. Org install still requires each other member to authorize for user tokens. SAML orgs need an active SAML session before re-auth.

**OAuth App / PAT:** skip for this product.
`;

const DOCS = [
  "docs/DESIGN.md",
  ...["comment-anchoring", "crdt-choice", "crdts-in-production", "github-integration", "markdown-editors", "offline-sync", "permissions", "prior-art-patchwork-git-bridges", "prior-products", "agent-protocols"].map(
    (f) => `docs/research/${f}.md`,
  ),
  "experiments/RESULTS.md",
  "experiments/github/FINDING.md",
  "demo.md",
];

export function showFigmaFixture() {
  const at = new Date(Date.now() - 23 * 60_000).toISOString().slice(0, 16) + "Z";
  const msg = `@Satanworker ${at}: I’m not sure we need to street it. Maybe lets try another way\n`;
  const threads = `\n<!--rl:t1\n${msg}${msg}${msg}-->\n<!--rl:t2\n${msg}-->\n`;
  // the History tab's count: the design shows 10 (commits with conflicts to settle)
  const conflicts = [{ from: "", to: "", human: "", agent: "" }];
  const marks: Record<string, AgentMark> = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`fixture${i}`, { sha: `fixture${i}`, author: "agent", message: "edit", at, conflicts }]),
  );
  const handle = new Repo({ network: [] }).create<RLDoc>({ text: TEXT + threads, marks });
  handle.on("change", docChanged); // as docStore's open() does: the word count follows typing
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
    imageUrl: async () => null, // the design shows the image's markdown line only
    poll: async () => {},
    anchor: () => ({ from: "", to: "" }),
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
    tabs: ["demo.md"],
    filesHidden: false,
    panelHidden: false,
  });
  fixtureDoc({
    session,
    login: "satanworker",
    status: { saving: false, dirty: false, commit: "9d164de52712fd3d5373d4f8ae31e3de0b80ad35", people: [], online: true, baseHead: "" },
    picked: true,
    tab: "comments",
  });

  // The design's UI state: docs, experiments and experiments/github open; the comment box open on the quote.
  requestAnimationFrame(() => {
    for (const s of document.querySelectorAll<HTMLElement>("#files summary")) {
      const d = s.parentElement as HTMLDetailsElement;
      d.open = ["docs", "experiments", "github"].includes(s.textContent!.trim());
    }
    const view = EditorView.findFromDOM(document.querySelector<HTMLElement>(".cm-editor")!);
    const from = view?.state.doc.toString().indexOf(sentence) ?? -1;
    if (!view || from < 0) return;
    view.focus();
    view.dispatch({ selection: { anchor: from, head: from + sentence.length } });
    startComment();
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
        {layer("/dev/figma-sidebar.png", 0, 35, 327, 867)}
        {layer("/dev/figma-doc.png", 320, 70, 800, 830)}
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
