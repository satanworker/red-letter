import * as A from "@automerge/automerge";
import { plain } from "../comments/inline.ts";
import type { Commit } from "../repo/repoService.ts";
import { editRegions, type Region } from "./regions.ts";
import type { AgentMark, Session } from "./session.ts";

type PanelState = { picked: boolean; tab: "comments" | "history" };
export type HistoryEntry = { commit: Commit; conflicts?: AgentMark };

// Agent commits with conflicts still to settle, oldest first (marks of older docs may hold none: left out).
export const selectMarks = (session: Session): AgentMark[] =>
  Object.values(session.doc.marks ?? {})
    .filter((m) => m.conflicts?.length)
    .sort((a, b) => a.at.localeCompare(b.at));

// The file's commits, newest first, each agent commit with conflicts to settle carrying its mark. A mark whose commit
// isn't in the list (not loaded yet, offline, older than the last 50) goes on top so it can still be settled.
export function selectHistory(history: Commit[], marks: AgentMark[]): HistoryEntry[] {
  const bySha = new Map(marks.map((m) => [m.sha, m]));
  const listed = new Set(history.map((c) => c.sha));
  const orphans = marks
    .filter((m) => !listed.has(m.sha))
    .reverse()
    .map((m) => ({ commit: { sha: m.sha, message: m.message, author: m.author, date: m.at, merge: false }, conflicts: m }));
  return [...orphans, ...history.map((c) => ({ commit: c, conflicts: bySha.get(c.sha) }))];
}

// A draft's edits against its base branch (as last merged in): ranges in the current text, deleted text in `before`.
export const selectDraftChanges = (s: Session): Region[] => (s.doc.base ? editRegions(s.doc, s.doc.base.heads, A.getHeads(s.doc)) : []);

// The chosen tab; until one is chosen, History when conflicts wait to be settled and no comments are open.
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

export type Heading = { depth: number; text: string; at: number };
// The doc's `#` headings, for its table of contents (code fences and comment markup skipped). A lone leading `#`
// heading is the doc's title and stays out, as Linear keeps its title out of a document's contents. `at`: where the
// heading's line starts in the doc's text; `text`: its words, without emphasis or code marks; `depth`: 0-2, levels
// below the top level of what's left.
export function selectHeadings(text: string): Heading[] {
  const p = plain(text);
  const found: (Heading & { level: number })[] = [];
  let fenced = false;
  for (let pos = 0; pos <= p.text.length; ) {
    let eol = p.text.indexOf("\n", pos);
    if (eol < 0) eol = p.text.length;
    const line = p.text.slice(pos, eol);
    if (/^ {0,3}(```|~~~)/.test(line)) fenced = !fenced;
    const h = !fenced && /^ {0,3}(#{1,6}) +(.*?)(?: +#+)? *$/.exec(line);
    const words = h && h[2].replace(/[*_`]/g, "").trim();
    if (h && words) found.push({ level: h[1].length, depth: 0, text: words, at: p.toText(pos, 1) });
    pos = eol + 1;
  }
  const title = found[0]?.level === 1 && !found.slice(1).some((h) => h.level === 1) ? 1 : 0;
  const rest = found.slice(title);
  const top = Math.min(...rest.map((h) => h.level));
  return rest.map((h) => ({ depth: Math.min(h.level - top, 2), text: h.text, at: h.at }));
}
