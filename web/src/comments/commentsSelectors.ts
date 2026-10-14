import type { Session } from "../doc/session.ts";
import type { Comment } from "./commentsService.ts";

export type Thread = { root: Comment; replies: Comment[]; range: { from: number; to: number } | null; moved: boolean };

// Threads in document order. A comment is placed by its Automerge cursors, or by its quote when the doc was
// recreated since; `moved` = the anchored text no longer matches the quote.
export function selectThreads(session: Session, list: Comment[]): Thread[] {
  const text = session.doc.text;
  return list
    .filter((c) => !c.parent)
    .map((root) => {
      let range: Thread["range"] = null;
      if (root.docId === session.docId && root.from && root.to) range = session.resolve({ from: root.from, to: root.to });
      if (!range && root.quote) {
        const i = text.indexOf(root.quote);
        if (i >= 0) range = { from: i, to: i + root.quote.length };
      }
      const moved = !!range && !!root.quote && text.slice(range.from, range.to) !== root.quote;
      return { root, replies: list.filter((c) => c.parent === root.id), range, moved };
    })
    .sort((a, b) => (a.range?.from ?? Infinity) - (b.range?.from ?? Infinity));
}
