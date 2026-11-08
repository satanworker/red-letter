// Editor stress benchmark: builds the app, opens /__stress (src/dev/stress.ts) in a headless Chromium of its own and
// measures what a writer feels, against the budgets of a native macOS text view (the key shows in the next 60 Hz
// frame, no dropped frames while scrolling).
//
//   cd web && bun bench/stress.ts [--sections 25,400] [--only type-mid,scroll] [--profile type-mid] [--out results.json]
//
// CHROME=<path> picks the browser (default: chromium on PATH); --url <origin> measures a running app instead of a
// fresh build. Exits 1 when a budget fails.
// --profile <scenario> (or open) writes <scenario>.json (a trace: DevTools › Performance › Load profile) and
// <scenario>.cpuprofile, and prints what took the main thread's time; NO_MINIFY=1 keeps function names readable.
//
// Latency is "input to next paint": from the key event's timestamp to the task after the frame that follows it (the
// frame's rAF callbacks, style, layout and paint have run by then). Scroll smoothness counts the main thread's frames.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../build.ts";

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]! : def;
};
const SIZES = arg("sections", "25,400").split(",").map(Number);
const PROFILE = arg("profile", "");
const OUT = arg("out", "");
const ONLY = arg("only", "").split(",").filter(Boolean);
const FRAME = 1000 / 60;
const dir = mkdtempSync(join(tmpdir(), "rl-bench-"));

// ---- the app: built into a directory of its own (edits made while it runs don't reach it), served as dev.ts does
// minus the service worker, whose precaching would compete with the measurements ----
let URL_ = arg("url", "");
if (!URL_) {
  const site = join(dir, "site");
  await build(site);
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      const f = Bun.file(site + pathname);
      if (pathname.startsWith("/assets/") && (await f.exists())) return new Response(f);
      if (pathname === "/sw.js") return new Response("", { status: 404 });
      return new Response(Bun.file(`${site}/index.html`));
    },
  });
  URL_ = server.url.origin;
}

// ---- Chromium over the DevTools protocol ----
const chrome = Bun.spawn(
  [process.env.CHROME ?? "chromium", "--headless=new", "--window-size=1440,900", "--no-first-run", "--no-default-browser-check", "--disable-extensions", `--user-data-dir=${join(dir, "chrome")}`, "--remote-debugging-port=0", "about:blank"],
  { stdout: "ignore", stderr: "ignore" },
);
process.on("exit", () => {
  chrome.kill();
  rmSync(dir, { recursive: true, force: true });
});
let port = "";
for (let i = 0; i < 100 && !port; i++) {
  await Bun.sleep(100);
  try {
    port = readFileSync(join(dir, "chrome", "DevToolsActivePort"), "utf8").split("\n")[0]!;
  } catch {}
}
if (!port) throw new Error("Chromium didn't start (set CHROME=<path>)");
const pages = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
const ws = new WebSocket(pages.find((p) => p.type === "page")!.webSocketDebuggerUrl);
const opened = Promise.withResolvers<void>();
ws.onopen = () => opened.resolve();
await opened.promise;
let nextId = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
type TraceEvent = { name: string; ph: string; ts: number; dur?: number; tid: number; args?: { name?: string } };
let traced: TraceEvent[] = [];
let traceDone = Promise.withResolvers<void>();
ws.onmessage = (m) => {
  const msg = JSON.parse(String(m.data)) as { id?: number; result?: unknown; error?: { message: string; data?: string }; method?: string; params?: { value?: TraceEvent[] } };
  if (msg.method === "Tracing.dataCollected") traced.push(...msg.params!.value!);
  if (msg.method === "Tracing.tracingComplete") traceDone.resolve();
  const p = msg.id === undefined ? undefined : pending.get(msg.id);
  if (!p) return; // an event
  pending.delete(msg.id!);
  if (msg.error) p.reject(new Error(`${msg.error.message} ${msg.error.data ?? ""}`));
  else p.resolve(msg.result);
};
// T: the method's result as the protocol documents it (chromedevtools.github.io/devtools-protocol)
function cdp<T = unknown>(method: string, params: object = {}): Promise<T> {
  const id = ++nextId;
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
  ws.send(JSON.stringify({ id, method, params }));
  return promise;
}
type Evaluated = { result: { value: unknown }; exceptionDetails?: { text: string; exception?: { description?: string } } };
// T: what the expression returns (by value)
async function js<T>(expression: string): Promise<T> {
  const r = await cdp<Evaluated>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`${expression.slice(0, 80)}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value as T;
}
await cdp("Page.enable");
await cdp("Performance.enable");
await cdp("Profiler.enable");
await cdp("Profiler.setSamplingInterval", { interval: 200 }); // µs
await cdp("Emulation.setFocusEmulationEnabled", { enabled: true }); // headless: the page has focus, so the editor takes keys

// ---- input ----
const KEYS: Record<string, { code: string; vk: number; text?: string }> = {
  Enter: { code: "Enter", vk: 13, text: "\r" },
  Backspace: { code: "Backspace", vk: 8 },
  ArrowDown: { code: "ArrowDown", vk: 40 },
  ArrowUp: { code: "ArrowUp", vk: 38 },
};
async function key(k: string) {
  const named = KEYS[k];
  const p = named
    ? { key: k, code: named.code, windowsVirtualKeyCode: named.vk, text: named.text }
    : { key: k, code: k === " " ? "Space" : `Key${k.toUpperCase()}`, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0), text: k };
  await cdp("Input.dispatchKeyEvent", { type: named && !named.text ? "rawKeyDown" : "keyDown", ...p });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...p, text: undefined });
}
// keys at a steady pace, as a fast typist or key repeat sends them, whether or not the page has caught up
async function press(keys: string[], every: number) {
  const start = performance.now();
  for (let i = 0; i < keys.length; i++) {
    await Bun.sleep(Math.max(0, start + i * every - performance.now()));
    await key(keys[i]!);
  }
  await Bun.sleep(300);
}

// ---- in-page probes ----
const PROBES = `(() => {
  window.bench = { lat: [], frames: [], loaf: [], recording: false };
  addEventListener("keydown", (e) => {
    const t0 = e.timeStamp;
    requestAnimationFrame(() => {
      const c = new MessageChannel();
      c.port1.onmessage = () => bench.lat.push(performance.now() - t0);
      c.port2.postMessage(0);
    });
  }, true);
  const tick = (t) => { if (bench.recording) bench.frames.push(t); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) bench.loaf.push({ d: e.duration, scripts: e.scripts.map((s) => ({ d: s.duration, where: (s.sourceFunctionName || s.invoker) + " " + (s.sourceURL.split("/").pop() || "") })) });
  }).observe({ type: "long-animation-frame" });
})()`;
const reset = () => js(`(bench.lat = [], bench.frames = [], bench.loaf = [], 0)`);

const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};

// value: what the budget applies to (p95 latency, or the share of frames dropped); budget: set from the native floor
// measured on the same machine (see the run); ok: value within budget
type Row = { scenario: string; n: number; p50: number; p95: number; max: number; value: number; unit: string; budget: number; ok: boolean; extra?: string };

async function latency(scenario: string, setup: string, keys: string[], every: number): Promise<Row> {
  await js(setup);
  await Bun.sleep(400);
  await reset();
  if (PROFILE === scenario) await startProfile();
  await press(keys, every);
  if (PROFILE === scenario) await saveProfile(scenario);
  const lat = await js<number[]>("bench.lat");
  const p95 = pct(lat, 95);
  return { scenario, n: lat.length, p50: pct(lat, 50), p95, max: Math.max(...lat), value: p95, unit: "ms p95", budget: NaN, ok: false, extra: await longFrames() };
}

// the worst long animation frame's biggest scripts: who held the main thread
async function longFrames(): Promise<string> {
  const loaf = await js<{ d: number; scripts: { d: number; where: string }[] }[]>("bench.loaf");
  if (!loaf.length) return "";
  const worst = loaf.reduce((a, b) => (b.d > a.d ? b : a));
  const top = worst.scripts.sort((a, b) => b.d - a.d).slice(0, 2).map((s) => `${s.where.trim()} ${s.d.toFixed(0)}ms`);
  return `${loaf.length} long frames, worst ${worst.d.toFixed(0)}ms${top.length ? `: ${top.join(", ")}` : ""}`;
}

async function scroll(scenario: string, dy: number, ms: number): Promise<Row> {
  await js(`(document.getElementById("doc").scrollTop = 0, 0)`);
  await Bun.sleep(500);
  await reset();
  if (PROFILE === scenario) await startProfile();
  await js(`(bench.recording = true, 0)`);
  const start = performance.now();
  for (let i = 0; performance.now() - start < ms; i++) {
    await Bun.sleep(Math.max(0, start + i * FRAME - performance.now()));
    await cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x: 720, y: 450, deltaX: 0, deltaY: dy });
  }
  await Bun.sleep(200);
  await js(`(bench.recording = false, 0)`);
  if (PROFILE === scenario) await saveProfile(scenario);
  const t = await js<number[]>("bench.frames");
  const gaps = t.slice(1).map((x, i) => x - t[i]!);
  const dropped = gaps.reduce((n, g) => n + Math.max(0, Math.round(g / FRAME) - 1), 0);
  const share = (dropped / (gaps.length + dropped)) * 100;
  return { scenario, n: gaps.length, p50: pct(gaps, 50), p95: pct(gaps, 95), max: Math.max(...gaps), value: share, unit: "% dropped", budget: NaN, ok: false, extra: await longFrames() };
}

// jumps far into the doc (scrollbar drag, a table of contents click): until the new spot has painted
async function jumps(scenario: string): Promise<Row> {
  if (PROFILE === scenario) await startProfile();
  const lat = await js<number[]>(`(async () => {
    const s = document.getElementById("doc"), out = [];
    let seed = 7;
    for (let i = 0; i < 20; i++) {
      seed = (seed * 48271) % 2147483647;
      const t0 = performance.now();
      s.scrollTop = (seed / 2147483647) * (s.scrollHeight - s.clientHeight);
      await new Promise((r) => requestAnimationFrame(() => { const c = new MessageChannel(); c.port1.onmessage = r; c.port2.postMessage(0); }));
      out.push(performance.now() - t0);
      await new Promise((r) => setTimeout(r, 150));
    }
    return out;
  })()`);
  if (PROFILE === scenario) await saveProfile(scenario);
  const p95 = pct(lat, 95);
  return { scenario, n: lat.length, p50: pct(lat, 50), p95, max: Math.max(...lat), value: p95, unit: "ms p95", budget: NaN, ok: false };
}

// A DevTools trace (<name>.json: load it in DevTools › Performance) and a CPU profile of one scenario; prints the main
// thread's busiest trace events (style, layout, paint, …) and JS functions, by self time.
async function startProfile() {
  traced = [];
  traceDone = Promise.withResolvers<void>();
  await cdp("Tracing.start", { categories: "devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,v8.execute", transferMode: "ReportEvents" });
  await cdp("Profiler.start");
}
type Profile = { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }[]; samples: number[]; timeDeltas: number[] };
async function saveProfile(name: string) {
  const { profile } = await cdp<{ profile: Profile }>("Profiler.stop");
  await cdp("Tracing.end");
  await traceDone.promise;
  writeFileSync(`${name}.cpuprofile`, JSON.stringify(profile));
  writeFileSync(`${name}.json`, JSON.stringify({ traceEvents: traced }));
  const top = (title: string, self: Map<string, number>) => {
    console.log(`\n${title}, self time:`);
    for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${v.toFixed(1).padStart(8)} ms  ${k}`);
  };

  const main = new Set(traced.filter((e) => e.ph === "M" && e.name === "thread_name" && e.args?.name === "CrRendererMain").map((e) => e.tid));
  const evs = traced.filter((e) => main.has(e.tid) && e.ph === "X" && e.dur).sort((a, b) => a.tid - b.tid || a.ts - b.ts || b.dur! - a.dur!);
  const stack: { end: number; tid: number; name: string; self: number }[] = [];
  const phases = new Map<string, number>();
  const close = (tid: number, until: number) => {
    while (stack.length && (stack.at(-1)!.tid !== tid || stack.at(-1)!.end <= until)) {
      const s = stack.pop()!;
      phases.set(s.name, (phases.get(s.name) ?? 0) + s.self / 1000);
    }
  };
  for (const e of evs) {
    close(e.tid, e.ts);
    if (stack.length) stack.at(-1)!.self -= e.dur!;
    stack.push({ end: e.ts + e.dur!, tid: e.tid, name: e.name, self: e.dur! });
  }
  close(-1, Infinity);
  top(`${name}.json, main thread`, phases);

  const fns = new Map<string, number>();
  const byId = new Map(profile.nodes.map((n) => [n.id, n.callFrame]));
  profile.samples.forEach((id, i) => {
    const f = byId.get(id)!;
    const k = `${f.functionName || "(anonymous)"} ${f.url.split("/").pop()}:${f.lineNumber + 1}`;
    if (k.startsWith("(idle)") || k.startsWith("(program)")) return;
    fns.set(k, (fns.get(k) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
  });
  top(`${name}.cpuprofile, JS`, fns);
}

// ---- the run ----
const typed = (n: number) => Array.from({ length: n }, (_, i) => "the quick brown fox jumps over a lazy dog "[i % 42]!);
// caret at the end of the first paragraph line after a heading (or a cell's / code line's text) found by `find`
const at = (find: string) => `(() => {
  const v = stress.view, d = v.state.doc;
  let pos = ${find};
  v.focus();
  v.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
})()`;
// where section n's heading starts (sections 1, 5, 9, … carry an emoji first), as an expression over the doc's text `t`
const heading = (n: number) => `((h) => { if (h < 0) throw new Error("no section ${n}"); return h; })(t.search(/^## (?:\\S+ )?${n}\\. /m))`;
const paraAfter = (h: string) => `(() => { const d = stress.view.state.doc, t = d.toString(); const h = ${h}; return d.lineAt(t.indexOf("\\n\\n", h) + 2).to; })()`;

const results: { sections: number; lines: number; chars: number; openMs: number; heapMB: number; nodes: number; rows: Row[] }[] = [];
for (const sections of SIZES) {
  if (PROFILE === "open") await startProfile();
  await cdp("Page.navigate", { url: `${URL_}/__stress?sections=${sections}` });
  let info: { lines: number; chars: number } | null = null;
  for (let i = 0; i < 600 && !info; i++) {
    await Bun.sleep(100);
    info = await js<{ lines: number; chars: number } | null>(`window.stress?.view ? { lines: stress.lines, chars: stress.chars } : null`).catch(() => null);
  }
  if (!info) throw new Error(`${URL_}/__stress?sections=${sections} didn't open`);
  if (PROFILE === "open") await saveProfile("open");
  const openMs = await js<number>(`performance.measure("open", "fixture:doc", "stress:ready").duration`);
  await js(PROBES);
  // load the lazy chunks (code highlighting, mermaid) and let images and diagrams settle before measuring
  await js(`(async () => { const s = document.getElementById("doc"); for (let y = 0; y < s.scrollHeight; y += 4000) { s.scrollTop = y; await new Promise((r) => setTimeout(r, 30)); } s.scrollTop = 0; })()`);
  await Bun.sleep(1500);
  const mid = Math.floor(sections / 2) + 1;
  const n = 60;
  const scenarios: [string, () => Promise<Row>][] = [
    ["type-top", () => latency("type-top", at(paraAfter(`t.indexOf("# 🧪")`)), typed(n), 80)],
    ["delete-top", () => latency("delete-top", at(paraAfter(`t.indexOf("# 🧪")`)), Array(n).fill("Backspace"), 80)],
    ["type-mid", () => latency("type-mid", at(paraAfter(heading(mid))), typed(n), 80)],
    ["enter-mid", () => latency("enter-mid", `0`, Array(10).fill(0).flatMap(() => ["Enter", "Backspace"]), 120)],
    ["type-code", () => latency("type-code", at(`(() => { const t = d.toString(); const h = ${heading(mid)}; return d.line(d.lineAt(t.indexOf("\\n\`\`\`", h) + 1).number + 1).to; })()`), typed(40), 80)],
    // sections 1, 4, 7, … have a table; caret at the end of its first body cell
    ["type-cell", () => latency("type-cell", `(async () => {
      const v = stress.view, t = v.state.doc.toString();
      v.dispatch({ selection: { anchor: t.indexOf("\\n| ", ${heading(3 * Math.floor(sections / 6) + 1)}) + 1 }, scrollIntoView: true });
      await new Promise((r) => setTimeout(r, 100));
      const td = [...document.querySelectorAll(".cm-lp-table td")].find((el) => { const b = el.getBoundingClientRect(); return b.top > 0 && b.bottom < innerHeight; });
      if (!td) throw new Error("no table cell in view");
      td.focus();
      const r = document.createRange();
      r.selectNodeContents(td);
      r.collapse(false);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    })()`, typed(40), 80)],
    ["arrows", () => latency("arrows", at(paraAfter(heading(mid))), [...Array(40).fill("ArrowDown"), ...Array(40).fill("ArrowUp")], 33)],
    ["scroll", () => scroll("scroll", 100, 3000)],
    ["fling", () => scroll("fling", 600, 2000)],
    ["jump", () => jumps("jump")],
  ];
  const rows: Row[] = [];
  for (const [name, run] of scenarios) if (!ONLY.length || ONLY.includes(name)) rows.push(await run());
  const { metrics } = await cdp<{ metrics: { name: string; value: number }[] }>("Performance.getMetrics");
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));

  // The floor: what this machine and browser manage with no editor at all, measured the same way after the app's
  // runs (it replaces the page). The same text as a static page for scrolling and jumping, and the browser's own text
  // field (a <textarea>, C++ inside the engine) holding a screenful of it for typing: a whole long doc would measure
  // the textarea laying all of it out, slower than the editor. Budgets: typing within the field's p95 + 4 ms, a
  // jump within one frame of the static page's, scrolling within 2 points of its dropped frames.
  const text = await js<string>("stress.view.state.doc.toString()");
  await js(`(() => {
    document.body.innerHTML = '<div id="doc" style="height:100vh;overflow:auto"><div style="width:620px;margin:auto;white-space:pre-wrap;font:12px/16px sans-serif"></div></div>';
    document.querySelector("#doc > div").textContent = ${JSON.stringify(text)};
  })()`);
  await Bun.sleep(1000);
  const floor: Record<string, Row> = { scroll: await scroll("native scroll", 100, 3000), fling: await scroll("native fling", 600, 2000), jump: await jumps("native jump") };
  floor.type = await latency("native type", `(() => {
    const text = ${JSON.stringify(text.slice((text.length >> 1) - 2000, (text.length >> 1) + 2000))};
    document.body.innerHTML = '<textarea style="width:620px;height:860px;font:12px/16px monospace"></textarea>';
    const t = document.querySelector("textarea");
    t.value = text;
    t.focus();
    t.setSelectionRange(2000, 2000);
  })()`, typed(n), 80);
  const slack: Record<string, number> = { scroll: 2, fling: 2, jump: FRAME, type: 4 };
  for (const r of rows) {
    const kind = r.scenario in floor ? r.scenario : "type";
    r.budget = floor[kind]!.value + slack[kind]!;
    r.ok = r.value <= r.budget;
  }
  for (const [kind, r] of Object.entries(floor)) rows.push({ ...r, ok: true, extra: kind === "type" ? "a <textarea>" : "the text as a static page" });
  results.push({ sections, ...info, openMs, heapMB: m.JSHeapUsedSize / 2 ** 20, nodes: m.Nodes, rows });
}

const f = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "–");
let failed = false;
for (const r of results) {
  const openOk = r.openMs <= 500;
  failed ||= !openOk || r.rows.some((x) => !x.ok);
  console.log(`\n## ${r.sections} sections: ${r.lines} lines, ${(r.chars / 1024).toFixed(0)} KB · open ${f(r.openMs)} ms ${openOk ? "ok" : "FAIL"} (budget 500) · JS heap ${f(r.heapMB)} MB · ${r.nodes} DOM nodes\n`);
  console.log("| scenario | n | p50 ms | p95 ms | max ms | measured | budget | | notes |\n|---|---|---|---|---|---|---|---|---|");
  for (const x of r.rows) {
    const native = x.scenario.startsWith("native");
    console.log(`| ${x.scenario} | ${x.n} | ${f(x.p50)} | ${f(x.p95)} | ${f(x.max)} | ${f(x.value)} ${x.unit} | ${native ? "" : f(x.budget)} | ${native ? "" : x.ok ? "ok" : "FAIL"} | ${x.extra ?? ""} |`);
  }
}
if (OUT) writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), url: URL_, results }, null, 2));
process.exit(failed ? 1 : 0);
