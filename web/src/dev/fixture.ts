// Dev pages (/__figma, /__stress): the editor screen on a local doc, with no GitHub, hub or IndexedDB behind it.
import { Repo } from "@automerge/automerge-repo";
import { docChanged, fixtureDoc } from "../doc/docStore.ts";
import type { AgentMark, RLDoc, Session } from "../doc/session.ts";
import { fixtureRepo } from "../repo/repoStore.ts";

type Fixture = { text: string; docs: string[]; path: string; marks?: Record<string, AgentMark>; imageUrl?: (src: string) => Promise<string | null> };

export function showFixture(f: Fixture): Session {
  const handle = new Repo({ network: [] }).create<RLDoc>({ text: f.text, marks: f.marks ?? {} });
  handle.on("change", docChanged); // as docStore's open() does: the word count follows typing
  performance.mark("fixture:doc"); // the CRDT doc exists; what follows is opening it on screen
  const session = {
    repoName: "satanworker/red-letter",
    branch: "demo",
    path: f.path,
    canWrite: true,
    handle,
    flushEdits: () => {},
    get doc() {
      session.flushEdits();
      return handle.doc()!;
    },
    get docId() {
      return handle.documentId;
    },
    resolve: () => null,
    imageUrl: f.imageUrl ?? (async () => null),
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
    docs: f.docs,
    path: f.path,
    tabs: [f.path],
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
  return session;
}
