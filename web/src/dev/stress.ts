// /__stress?sections=N (dev only; its own chunk): the editor on one huge generated doc with every kind of block the
// editor draws (headings, emphasis, links, lists, tasks, quotes, code in six languages, tables, images, mermaid,
// rules, comment threads), the same text for the same N. &doc=tables: N tables instead (tablesDoc). web/bench/stress.ts
// drives it and measures.
import { EditorView } from "@codemirror/view";
import { showFixture } from "./fixture.ts";

const WORDS = (
  "git canonical crdt live working copy branch replay commit merge agent browser snapshot heads tree blob token " +
  "sync hub room peer offline cursor anchor review conflict draft history patch diff text markdown table diagram " +
  "editor viewport decoration widget layout frame paint scroll latency budget native smooth"
).split(" ");
const EMOJI = ["🚀", "📦", "🧭", "🔥", "🧪", "📐", "🛰️", "🧵"];
const LANGS = ["ts", "python", "rust", "json", "bash", "go"];

export function stressDoc(sections: number): string {
  let seed = 1;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)]!;
  const words = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join(" ");
  const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
  const inline = () =>
    pick([
      () => `**${words(2)}**`,
      () => `*${words(2)}*`,
      () => `***${words(1)}***`,
      () => `\`${pick(WORDS)}()\``,
      () => `~~${words(2)}~~`,
      () => `[${words(2)}](https://example.com/${pick(WORDS)}/${pick(WORDS)}.html)`,
      () => `https://github.com/satanworker/${pick(WORDS)}/blob/main/${pick(WORDS)}.md`,
      () => words(3),
    ])();
  const sentence = () => `${cap(words(4 + Math.floor(rnd() * 6)))} ${inline()} ${words(3 + Math.floor(rnd() * 5))}.`;
  const para = (n: number) => Array.from({ length: n }, sentence).join(" ");
  const code: Record<string, (i: number) => string> = {
    ts: (i) => `export async function load${i}(id: string): Promise<Doc> {\n  const res = await fetch(\`/api/docs/\${id}\`, { cache: "no-store" });\n  if (!res.ok) throw new Error(\`load \${id}: \${res.status}\`);\n  const doc = (await res.json()) as Doc;\n  for (const [k, v] of Object.entries(doc.meta)) console.log(k, v);\n  return { ...doc, loaded: Date.now() };\n}`,
    python: (i) => `def replay_${i}(doc, heads, text):\n    """Fork at heads and apply the new text."""\n    fork = doc.fork(heads)\n    for change in diff(fork.text, text):\n        fork.splice(change.at, change.delete, change.insert)\n    return fork.save()`,
    rust: (i) => `pub fn merge_${i}(a: &[u8], b: &[u8]) -> Result<Vec<u8>, Error> {\n    let mut doc = AutoCommit::load(a)?;\n    let other = AutoCommit::load(b)?;\n    doc.merge(&mut other.clone())?;\n    Ok(doc.save())\n}`,
    json: (i) => `{\n  "docId": "doc-${i}",\n  "branch": "main",\n  "heads": ["${i}a1b2c3", "${i}d4e5f6"],\n  "replayVersion": 1,\n  "crlf": false\n}`,
    bash: (i) => `#!/usr/bin/env bash\nset -euo pipefail\ngit fetch origin "refs/red-letter/*:refs/red-letter/*"\nfor f in docs/*.md; do\n  echo "section ${i}: $f" && wc -l "$f"\ndone`,
    go: (i) => `func (h *Hub) Route${i}(m Msg) error {\n\th.mu.Lock()\n\tdefer h.mu.Unlock()\n\tfor id, p := range h.rooms[m.Room] {\n\t\tif id != m.From {\n\t\t\tp.Send(m)\n\t\t}\n\t}\n\treturn nil\n}`,
  };
  const out: string[] = [`# 🧪 Stress test: ${sections} sections`, "", para(3), ""];
  const threads: string[] = [];
  for (let i = 0; i < sections; i++) {
    const lang = LANGS[i % LANGS.length]!;
    const commented = i % 2 === 0 ? `<!--rl:s${i}-->${words(4)}<!--/rl:s${i}-->` : words(4);
    out.push(
      `## ${i % 4 === 0 ? `${pick(EMOJI)} ` : ""}${i + 1}. ${cap(words(3))}`,
      "",
      `${para(3)} ${cap(commented)} ${para(2)}`,
      "",
      `### ${cap(words(2))}`,
      "",
      ...Array.from({ length: 4 }, (_, j) => (j === 2 ? `  - ${sentence()}` : `- ${sentence()}`)),
      "",
      ...Array.from({ length: 3 }, (_, j) => `${j + 1}. ${sentence()}`),
      "",
      `- [x] ${sentence()}`,
      `- [ ] ${sentence()}`,
      "",
      `> ${para(2)}`,
      `> ${sentence()}`,
      "",
      "```" + lang,
      code[lang]!(i),
      "```",
      "",
    );
    if (i % 3 === 0) {
      const cols = 4 + (i % 3);
      out.push(
        `| ${Array.from({ length: cols }, () => cap(pick(WORDS))).join(" | ")} |`,
        `|${Array.from({ length: cols }, (_, c) => (c === cols - 1 ? " ---: " : " --- ")).join("|")}|`,
        ...Array.from({ length: 8 }, () => `| ${Array.from({ length: cols }, (_, c) => (c === 0 ? inline() : c === cols - 1 ? String(Math.floor(rnd() * 1e4)) : words(1 + Math.floor(rnd() * 3)))).join(" | ")} |`),
        "",
      );
    }
    if (i % 4 === 1) out.push(`![figure ${i}](images/figure-${i}.svg)`, "");
    if (i % 6 === 2) out.push("```mermaid", `flowchart LR`, `  A${i}[${cap(pick(WORDS))}] --> B${i}{${cap(pick(WORDS))}?}`, `  B${i} -->|yes| C${i}[${cap(pick(WORDS))}]`, `  B${i} -->|no| D${i}[${cap(pick(WORDS))}]`, "```", "");
    out.push(para(4), "", "---", "");
    if (i % 2 === 0) threads.push(`<!--rl:s${i}${i % 8 === 0 ? " resolved" : ""}\n@satanworker 2026-11-01T10:12Z: ${sentence()}\n@agent 2026-11-02: ${sentence()}\n-->`);
  }
  return [...out, ...threads, ""].join("\n");
}

// N tables of 10, 60 or 200 rows and 3, 6, 9 or 12 columns (9 and 12 scroll sideways in the 620px column), cells with
// inline markdown, between short sections; the middle one has 2,000 rows (its first cells say r0, r1, …).
export function tablesDoc(n: number): string {
  let seed = 2;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)]!;
  const words = (k: number) => Array.from({ length: k }, () => pick(WORDS)).join(" ");
  const cell = () => pick([() => `**${words(2)}**`, () => `\`${pick(WORDS)}()\``, () => `[${words(2)}](https://example.com/${pick(WORDS)})`, () => String(Math.floor(rnd() * 1e5)), () => words(1 + Math.floor(rnd() * 6))])();
  const out = [`# 🧪 Tables: ${n}`, ""];
  for (let i = 0; i < n; i++) {
    const rows = i === n >> 1 ? 2000 : [10, 60, 200][i % 3]!, cols = 3 + (i % 4) * 3;
    out.push(`## ${i + 1}. ${words(3)}`, "", `${words(20)}.`, "");
    out.push(`| ${Array.from({ length: cols }, () => words(1 + Math.floor(rnd() * 3))).join(" | ")} |`, `|${" --- |".repeat(cols)}`);
    for (let r = 0; r < rows; r++) out.push(`| ${Array.from({ length: cols }, (_, c) => (c === 0 ? `r${r} ${words(2)}` : cell())).join(" | ")} |`);
    out.push("");
  }
  return out.join("\n");
}

// A picture per src, of its own height, so images load late and move the text under them as real ones do.
const image = async (src: string) => {
  const h = 80 + ((src.length * 37) % 160);
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="560" height="${h}"><rect width="560" height="${h}" rx="8" fill="#ebebeb"/><text x="16" y="28" font-family="sans-serif" font-size="14" fill="#373737">${src}</text></svg>`)}`;
};

export function showStress() {
  const q = new URLSearchParams(location.search);
  const sections = Number(q.get("sections")) || 200;
  const text = q.get("doc") === "tables" ? tablesDoc(sections) : stressDoc(sections);
  showFixture({ text, docs: ["stress.md"], path: "stress.md", imageUrl: image });
  // ready once the editor has painted: the frame after mount, then the task after that frame (opening is measured
  // from the fixture's "fixture:doc" mark to "stress:ready")
  requestAnimationFrame(() =>
    setTimeout(() => {
      performance.mark("stress:ready");
      const view = EditorView.findFromDOM(document.querySelector<HTMLElement>(".cm-editor")!);
      Object.assign(window, { stress: { view, sections, lines: view?.state.doc.lines, chars: text.length } });
    }),
  );
}
