import * as A from "@automerge/automerge";
import { editRegions, type Region } from "./regions.ts";
import type { AgentMark, Session } from "./session.ts";

type PanelState = { panel: boolean | null; tab: "comments" | "changes" };

export const selectMarks = (session: Session): AgentMark[] => Object.values(session.doc.marks ?? {}).sort((a, b) => a.at.localeCompare(b.at));

// A comment being written lives in the editor (Figma 22:561), so it doesn't open the panel.
export const selectPanelVisible = (s: PanelState, openThreads: number, marks: number) => s.panel ?? (openThreads > 0 || marks > 0);

// A draft's edits against its base branch (as last merged in): ranges in the current text, deleted text in `before`.
export const selectDraftChanges = (s: Session): Region[] => (s.doc.base ? editRegions(s.doc, s.doc.base.heads, A.getHeads(s.doc)) : []);

// The chosen tab, unless it's empty and the other one isn't.
export function selectTab(s: PanelState, openThreads: number, marks: number) {
  if (s.tab === "changes" && !marks && openThreads) return "comments";
  if (s.tab === "comments" && !openThreads && marks && s.panel === null) return "changes";
  return s.tab;
}
