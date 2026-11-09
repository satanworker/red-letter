// Comments live in the doc as HTML comments, which GitHub's rendered view hides and agents read with the text:
//
//   The hub <!--rl:c1-->relays live sync<!--/rl:c1--> and nothing else.
//   …
//   <!--rl:c1
//   @satanworker 2026-11-01T10:12Z: Should this mention the OAuth exchange?
//   @agent 2026-11-01: Added a sentence.
//   -->
//
// Markers wrap the commented text; each thread's block sits at the end of the doc. A message starts a line with
// "@login date: " (the date is optional); lines indented by two spaces continue it. A resolved thread keeps its
// markers and messages and says so on its block's first line ("<!--rl:c1 resolved"); deleting one removes its markers
// and block, so git history is the record. Nothing inside fenced code counts.
// Pure text in, text edits out: the editor (direct) and the comment PR (commentsPr.ts) both apply them.

export type Message = { author: string; at: string; body: string };
// source: where the thread lives. "file": markup in the doc (below); "pr": a review thread on the branch's pull
// request (commentsSelectors.ts maps it onto the doc), with GitHub's ids for replying, resolving and deleting.
export type PrRef = { number: number; url: string; threadId: string; firstCommentId: number; outdated: boolean };
export type Thread = { id: string; range: { from: number; to: number } | null; quote: string; messages: Message[]; resolved: boolean; source: "file" | "pr"; pr?: PrRef };
export type Edit = { from: number; to: number; insert: string };
export type Span = { from: number; to: number };
export type Block = Span & { id: string; resolved: boolean; close: number; messages: Message[] }; // close: start of the "-->" line

const MARKER = /<!--(\/?)rl:([a-z0-9]+)-->/g;
const BLOCK = /^<!--rl:([a-z0-9]+)( resolved)?\n([\s\S]*?)^-->$\n?/gm;
const HEADER = /^@([A-Za-z0-9-]+(?:\[bot\])?)(?: (\d{4}-\d\d-\d\d(?:T[\d:.]+Z?)?))?: ?(.*)$/;

function fences(text: string): Span[] {
  const out: Span[] = [];
  let open: { at: number; fence: string } | null = null;
  for (let at = 0; at <= text.length; ) {
    const end = text.indexOf("\n", at);
    const line = text.slice(at, end < 0 ? text.length : end);
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (m && !open) open = { at, fence: m[1]! };
    else if (m && open && m[1]![0] === open.fence[0] && m[1]!.length >= open.fence.length && !line.slice(m[0].length).trim()) {
      out.push({ from: open.at, to: end < 0 ? text.length : end });
      open = null;
    }
    if (end < 0) break;
    at = end + 1;
  }
  if (open) out.push({ from: open.at, to: text.length });
  return out;
}

// A test for "inside one of these spans" (sorted, disjoint), asked at positions in increasing order.
function inside(spans: Span[]): (i: number) => boolean {
  let at = 0;
  return (i) => {
    while (at < spans.length && spans[at]!.to <= i) at++;
    return at < spans.length && spans[at]!.from <= i;
  };
}
const unescape = (s: string) => s.replaceAll("--&gt;", "-->");

// Messages by block text, most recently parsed last: a parse hands out the same arrays for unchanged blocks, so a list
// drawn from them (the comments panel) sees nothing new when typing elsewhere in the doc.
const seen = new Map<string, Message[]>();

export type Marker = Span & { id: string; open: boolean };
export type Parsed = { blocks: Block[]; markers: Marker[] };

export function parse(text: string): Parsed & { threads: Thread[] } {
  const code = fences(text);
  const inCode = inside(code);
  const blocks: Block[] = [];
  for (const m of text.matchAll(BLOCK)) {
    if (inCode(m.index)) continue;
    let messages = seen.get(m[3]!);
    if (messages) seen.delete(m[3]!);
    else {
      messages = [];
      for (const line of m[3]!.split("\n")) {
        const h = HEADER.exec(line);
        if (h) messages.push({ author: h[1]!, at: h[2] ?? "", body: unescape(h[3]!) });
        else if (messages.length && line) messages.at(-1)!.body += "\n" + unescape(line.replace(/^ {1,2}/, ""));
      }
    }
    seen.set(m[3]!, messages);
    blocks.push({ id: m[1]!, resolved: !!m[2], from: m.index, to: m.index + m[0].length, close: m.index + m[0].lastIndexOf("-->"), messages });
  }
  while (seen.size > 5000) seen.delete(seen.keys().next().value!);
  const markers: Marker[] = [];
  const inMarkerCode = inside(code), inBlock = inside(blocks);
  for (const m of text.matchAll(MARKER))
    if (!inMarkerCode(m.index) && !inBlock(m.index)) markers.push({ id: m[2]!, open: !m[1], from: m.index, to: m.index + m[0].length });
  return { threads: threadsOf({ blocks, markers }, (from, to) => text.slice(from, to)), blocks, markers };
}

// Each block's thread, its range between the first opening and closing markers of its id. slice: the doc's text.
export function threadsOf({ blocks, markers }: Parsed, slice: (from: number, to: number) => string): Thread[] {
  const opens = new Map<string, Marker>(), closes = new Map<string, Marker>();
  for (const k of markers) if (!(k.open ? opens : closes).has(k.id)) (k.open ? opens : closes).set(k.id, k);
  return blocks.map((b): Thread => {
    const start = opens.get(b.id), end = closes.get(b.id);
    const range = start && end && start.to <= end.from ? { from: start.to, to: end.from } : null;
    return { id: b.id, range, quote: range ? slice(range.from, range.to).replace(MARKER, "") : "", messages: b.messages, resolved: b.resolved, source: "file" };
  });
}

// What the editor hides: every marker and block.
export function hidden(text: string): Span[] {
  const { blocks, markers } = parse(text);
  return [...blocks, ...markers].sort((a, b) => a.from - b.from);
}

export const newId = () => Math.random().toString(36).slice(2, 8);
export const now = () => new Date().toISOString().slice(0, 16) + "Z";
const lines = (m: Message) => `@${m.author}${m.at && ` ${m.at}`}: ${m.body.replaceAll("-->", "--&gt;").replace(/\n/g, "\n  ")}\n`;

export function addThread(text: string, from: number, to: number, id: string, first: Message): Edit[] {
  const last = parse(text).blocks.at(-1);
  const gap = last?.to === text.length ? (text.endsWith("\n") ? "" : "\n") : text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  return [
    { from, to: from, insert: `<!--rl:${id}-->` },
    { from: to, to, insert: `<!--/rl:${id}-->` },
    { from: text.length, to: text.length, insert: `${gap}<!--rl:${id}\n${lines(first)}-->\n` },
  ];
}

export function reply(text: string, id: string, m: Message): Edit[] {
  const b = parse(text).blocks.find((x) => x.id === id);
  return b ? [{ from: b.close, to: b.close, insert: lines(m) }] : [];
}

// Resolve or reopen: the " resolved" flag after the block's id; markers and messages stay.
export function setResolved(text: string, id: string, resolved: boolean): Edit[] {
  const b = parse(text).blocks.find((x) => x.id === id);
  if (!b || b.resolved === resolved) return [];
  const at = b.from + `<!--rl:${id}`.length;
  return [resolved ? { from: at, to: at, insert: " resolved" } : { from: at, to: at + " resolved".length, insert: "" }];
}

export function remove(text: string, id: string): Edit[] {
  const { blocks, markers } = parse(text);
  const b = blocks.find((x) => x.id === id);
  if (!b) return [];
  // the last block goes with the blank line addThread put before it
  const from = b.to === text.length && blocks.at(-1) === b && text.slice(b.from - 2, b.from) === "\n\n" ? b.from - 1 : b.from;
  return [...markers.filter((k) => k.id === id).map((k) => ({ from: k.from, to: k.to, insert: "" })), { from, to: b.to, insert: "" }];
}

export function apply(text: string, edits: Edit[]): string {
  let out = "";
  let at = 0;
  for (const e of edits.map((e, i) => ({ ...e, i })).sort((a, b) => a.from - b.from || a.i - b.i)) {
    out += text.slice(at, e.from) + e.insert;
    at = Math.max(at, e.to);
  }
  return out + text.slice(at);
}

// The doc without comment markup, and back: positions in two texts that differ only in comments correspond through
// it (a protected branch's doc and its comment PR's copy). toText side -1: before markup sitting at that spot, 1: after.
export type Plain = { text: string; toPlain: (i: number) => number; toText: (p: number, side: -1 | 1) => number };
export function plain(text: string): Plain {
  const spans = hidden(text);
  let out = "";
  let at = 0;
  for (const s of spans) {
    out += text.slice(at, s.from);
    at = s.to;
  }
  out += text.slice(at);
  return {
    text: out,
    toPlain: (i) => spans.reduce((p, s) => (s.to <= i ? p - (s.to - s.from) : p), i),
    toText(p, side) {
      let i = p;
      for (const s of spans) {
        const sp = s.from - (i - p); // the span's plain position
        if (sp < p || (sp === p && side > 0)) i += s.to - s.from;
        else break;
      }
      return i;
    },
  };
}

// Same doc apart from comments (trailing blank lines too: addThread's gap)?
export const sameProse = (a: Plain, b: Plain) => a.text.trimEnd() === b.text.trimEnd();
