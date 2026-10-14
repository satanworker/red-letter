import type { AgentMark, Session } from "./session.ts";

type PanelState = { panel: boolean | null; tab: "comments" | "changes"; composing: unknown };

export const selectMarks = (session: Session): AgentMark[] => Object.values(session.doc.marks ?? {}).sort((a, b) => a.at.localeCompare(b.at));

export const selectConflictCount = (marks: AgentMark[]) => marks.reduce((n, m) => n + m.conflicts.length, 0);

export const selectPanelVisible = (s: PanelState, openThreads: number, marks: number) => s.panel ?? (openThreads > 0 || marks > 0 || !!s.composing);

// The chosen tab, unless it's empty and the other one isn't.
export function selectTab(s: PanelState, openThreads: number, marks: number) {
  if (s.tab === "changes" && !marks && (openThreads || s.composing)) return "comments";
  if (s.tab === "comments" && !openThreads && !s.composing && marks && s.panel === null) return "changes";
  return s.tab;
}
