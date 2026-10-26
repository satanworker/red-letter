import * as A from "@automerge/automerge";
import type { Commit } from "../repo/repoService.ts";
import { editRegions, type Region } from "./regions.ts";
import type { AgentMark, Session } from "./session.ts";

type PanelState = { picked: boolean; tab: "comments" | "history" };
export type HistoryEntry = { commit: Commit; review?: AgentMark };

export const selectMarks = (session: Session): AgentMark[] => Object.values(session.doc.marks ?? {}).sort((a, b) => a.at.localeCompare(b.at));

// The file's commits, newest first, each agent commit still waiting for review carrying its mark. A mark whose commit
// isn't in the list (not loaded yet, offline, older than the last 50) goes on top so it can still be reviewed.
export function selectHistory(history: Commit[], marks: AgentMark[]): HistoryEntry[] {
  const bySha = new Map(marks.map((m) => [m.sha, m]));
  const listed = new Set(history.map((c) => c.sha));
  const orphans = marks
    .filter((m) => !listed.has(m.sha))
    .reverse()
    .map((m) => ({ commit: { sha: m.sha, message: m.message, author: m.author, date: m.at, merge: false }, review: m }));
  return [...orphans, ...history.map((c) => ({ commit: c, review: bySha.get(c.sha) }))];
}

// A draft's edits against its base branch (as last merged in): ranges in the current text, deleted text in `before`.
export const selectDraftChanges = (s: Session): Region[] => (s.doc.base ? editRegions(s.doc, s.doc.base.heads, A.getHeads(s.doc)) : []);

// The chosen tab; until one is chosen, History when agent commits wait for review and no comments are open.
export const selectTab = (s: PanelState, openThreads: number, marks: number) => (!s.picked && !openThreads && marks ? "history" : s.tab);

const graphemes = new Intl.Segmenter();
// The first character of `s` (a whole grapheme: flags, skin tones, ZWJ sequences) if it's an emoji, else "".
export function firstEmoji(s: string): string {
  const g = graphemes.segment(s)[Symbol.iterator]().next().value?.segment ?? "";
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(g) ? g : "";
}

// The doc's icon: an emoji at the start of its first `# ` heading (code fences skipped). `at`: where the heading's
// text starts; `end`: where the icon and the space after it end (= at without an icon). null: no `# ` heading.
export function selectIcon(text: string): { icon: string; at: number; end: number } | null {
  let fenced = false;
  for (let pos = 0; pos <= text.length; ) {
    let eol = text.indexOf("\n", pos);
    if (eol < 0) eol = text.length;
    const line = text.slice(pos, eol);
    if (/^ {0,3}(```|~~~)/.test(line)) fenced = !fenced;
    const h = !fenced && /^ {0,3}# +/.exec(line);
    if (h) {
      const at = pos + h[0].length;
      const icon = firstEmoji(line.slice(h[0].length));
      const space = icon ? /^ */.exec(line.slice(h[0].length + icon.length))![0].length : 0;
      return { icon, at, end: at + icon.length + space };
    }
    pos = eol + 1;
  }
  return null;
}
