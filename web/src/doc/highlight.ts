// Syntax colours in fenced code blocks: @pierre/highlights (hand-written WebAssembly, ~0.3 ms per 1,000 lines),
// Pierre light/dark themes combined with CSS light-dark(), so they follow the page's colour scheme. Loaded on the
// first visible code block with a known language.
import { syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import type * as Highlights from "@pierre/highlights";
import type { Lang, Theme } from "@pierre/highlights";

type Lib = { hl: typeof Highlights; light: Theme; dark: Theme };
let lib: Lib | undefined;
let loading: Promise<Lib> | undefined;
const marks = new Map<string, Decoration>(); // style -> mark
const cache = new Map<string, [number, number, Decoration][]>(); // lang + code -> [from, to, mark] relative to the code

function tokens({ hl, light, dark }: Lib, lang: string, code: string) {
  const key = `${lang}\0${code}`;
  let out = cache.get(key);
  if (out) return out;
  out = [];
  const { tokens } = hl.codeToTokens(code, {
    lang: lang as Lang, // checked with isSupportedLanguage by the caller
    themes: { light, dark },
    defaultColor: "light-dark()",
    tokenizeMaxLineLength: 2000,
  });
  for (const line of tokens)
    for (const t of line) {
      if (!t.htmlStyle || !t.content.trim()) continue;
      const style = Object.entries(t.htmlStyle).map(([k, v]) => `${k}:${v}`).join(";");
      let mark = marks.get(style);
      if (!mark) marks.set(style, (mark = Decoration.mark({ attributes: { style } })));
      out.push([t.offset, t.offset + t.content.length, mark]);
    }
  cache.set(key, out);
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return out;
}

function build(view: EditorView, plugin: { decorations: DecorationSet }): DecorationSet {
  const { state } = view;
  const out: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges)
    syntaxTree(state).iterate({
      from,
      to,
      enter: (n) => {
        if (n.name !== "FencedCode") return;
        const info = n.node.getChild("CodeInfo"), text = n.node.getChild("CodeText");
        if (!info || !text) return false;
        const lang = state.sliceDoc(info.from, info.to).trim().toLowerCase();
        if (!lib) {
          if (!loading) {
            loading = Promise.all([import("@pierre/highlights"), import("@pierre/highlights/themes/pierre-light"), import("@pierre/highlights/themes/pierre-dark")])
              .then(([hl, light, dark]) => (lib = { hl, light: light.default, dark: dark.default }));
            void loading.then(() => {
              if (!view.dom.isConnected) return; // the file was closed meanwhile; the next one builds with lib
              plugin.decorations = build(view, plugin);
              view.dispatch({}); // re-read the decorations
            });
          }
          return false;
        }
        if (!lib.hl.isSupportedLanguage(lang)) return false;
        for (const [a, b, mark] of tokens(lib, lang, state.sliceDoc(text.from, text.to))) out.push(mark.range(text.from + a, text.from + b));
        return false;
      },
    });
  return Decoration.set(out, true);
}

export const codeHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    constructor(view: EditorView) { this.decorations = build(view, this); }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = build(u.view, this);
    }
  },
  { decorations: (p) => p.decorations },
);
