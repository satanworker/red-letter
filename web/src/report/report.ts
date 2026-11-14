// Bug reports: everything needed to debug a problem, kept in memory from page load and sent in one click (the
// floating button, ReportButton.tsx). Imported first by main.tsx, so it sees the app's first log line and request.
// Kept, in ring buffers: console output, uncaught errors and rejections, every fetch (method, URL without secrets,
// status, time, rate-limit left), slow frames with the scripts that ran in them (Long Animation Frames, Chrome 123+;
// long tasks elsewhere), heap samples, and breadcrumbs (navigations, clicks, visibility, network). At send time: the
// app's state (main.tsx's snapshot: route, doc status, review, PRs, never the doc's text), the browser and the build.
// Tokens never leave: Authorization headers aren't recorded and anything shaped like a GitHub token is masked.
// Sent to the hub (POST /report), which stores it for whoever runs it; GitHub issues would be public.
import { createStore } from "solid-js/store";
import { HUB, token } from "../github.ts";

const started = Date.now();
const since = () => Math.round(performance.now()); // ms since the page loaded

type Log = { t: number; level: string; msg: string };
type Net = { t: number; method: string; url: string; status: number; ms: number; left?: string; error?: string };
type Frame = { t: number; ms: number; blocking?: number; scripts?: { ms: number; invoker?: string; fn?: string; src?: string }[] };
const buf = {
  logs: [] as Log[],
  errors: [] as { t: number; kind: string; msg: string; stack?: string }[],
  net: [] as Net[],
  frames: [] as Frame[],
  heap: [] as { t: number; mb: number }[],
  crumbs: [] as { t: number; what: string }[],
};
const MAX: Record<keyof typeof buf, number> = { logs: 2000, errors: 100, net: 500, frames: 200, heap: 240, crumbs: 300 };
function keep<K extends keyof typeof buf>(k: K, v: (typeof buf)[K][number]) {
  const a = buf[k] as unknown[];
  a.push(v);
  if (a.length > MAX[k]) a.splice(0, a.length - MAX[k]);
}

const [state, set] = createStore({ problems: 0, sending: false, sent: "", error: "" });
// problems: errors and freezes since the last report, for the button's badge
export const report = state;
const problem = () => set("problems", (n) => n + 1);

// ---- capture ----
// "?code=…&state=…" on the sign-in callback and any token-like query value: dropped from recorded URLs
export const scrub = (url: string) => url.replace(/([?&](?:code|state|access_token|refresh_token|token|client_secret)=)[^&#]*/gi, "$1…");
const TOKEN = /\b(?:gh[opusr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b|Bearer\s+[A-Za-z0-9._-]{20,}/g;

function text(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Error) return `${v.name}: ${v.message}${v.stack ? `\n${v.stack}` : ""}`;
  try {
    return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? String(x) : x instanceof Node ? `<${x.nodeName}>` : x)) ?? String(v);
  } catch {
    return String(v); // cyclic
  }
}

for (const level of ["debug", "log", "info", "warn", "error"] as const) {
  const real = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    keep("logs", { t: since(), level, msg: args.map(text).join(" ").slice(0, 4000) });
    if (level === "error") problem();
    real(...args);
  };
}

addEventListener("error", (e) => {
  keep("errors", { t: since(), kind: "error", msg: `${e.message} (${e.filename}:${e.lineno}:${e.colno})`, stack: e.error instanceof Error ? e.error.stack : undefined });
  problem();
});
addEventListener("unhandledrejection", (e) => {
  const r: unknown = e.reason;
  keep("errors", { t: since(), kind: "unhandledrejection", msg: r instanceof Error ? `${r.name}: ${r.message}` : text(r), stack: r instanceof Error ? r.stack : undefined });
  problem();
});

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const t = since();
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  const url = scrub(input instanceof Request ? input.url : String(input));
  try {
    const res = await realFetch(input, init);
    keep("net", { t, method, url, status: res.status, ms: since() - t, left: res.headers.get("x-ratelimit-remaining") ?? undefined });
    return res;
  } catch (e) {
    keep("net", { t, method, url, status: 0, ms: since() - t, error: text(e) });
    throw e;
  }
};

// Frames over 100 ms, with what ran in them; a freeze (1 s or more, past the first 10 s of loading) counts as a problem
type LoAF = PerformanceEntry & {
  blockingDuration: number;
  scripts: { duration: number; invoker: string; sourceFunctionName: string; sourceURL: string; sourceCharPosition: number }[];
};
function frames(list: PerformanceObserverEntryList) {
  for (const e of list.getEntries() as LoAF[]) {
    if (e.duration < 100) continue;
    keep("frames", {
      t: Math.round(e.startTime),
      ms: Math.round(e.duration),
      blocking: e.blockingDuration === undefined ? undefined : Math.round(e.blockingDuration),
      scripts: e.scripts
        ?.slice()
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 5)
        .map((s) => ({ ms: Math.round(s.duration), invoker: s.invoker, fn: s.sourceFunctionName || undefined, src: s.sourceURL ? `${s.sourceURL}:${s.sourceCharPosition}` : undefined })),
    });
    if (e.duration >= 1000 && e.startTime > 10_000) problem();
  }
}
const types = PerformanceObserver.supportedEntryTypes ?? [];
const frameType = types.includes("long-animation-frame") ? "long-animation-frame" : types.includes("longtask") ? "longtask" : "";
if (frameType) new PerformanceObserver(frames).observe({ type: frameType, buffered: true });

type Memory = { usedJSHeapSize: number; jsHeapSizeLimit: number };
const memory = () => (performance as Performance & { memory?: Memory }).memory; // Chrome only
const sampleHeap = () => {
  const m = memory();
  if (m) keep("heap", { t: since(), mb: Math.round(m.usedJSHeapSize / 2 ** 20) });
};
setInterval(sampleHeap, 30_000);

const crumb = (what: string) => keep("crumbs", { t: since(), what });
window.navigation?.addEventListener("navigatesuccess", () => crumb(`navigated ${scrub(location.pathname + location.search)}`));
addEventListener(
  "click",
  (e) => {
    const el = e.target instanceof Element ? e.target.closest("button, a, [role=button], summary, input[type=checkbox]") : null;
    if (!el) return;
    const label = el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || el.tagName;
    crumb(`clicked ${el.tagName.toLowerCase()} "${label.trim().replace(/\s+/g, " ").slice(0, 60)}"`);
  },
  { capture: true },
);
addEventListener("visibilitychange", () => crumb(document.hidden ? "tab hidden" : "tab shown"));
addEventListener("online", () => crumb("online"));
addEventListener("offline", () => crumb("offline"));

// ---- the report ----
let snapshot: () => unknown = () => null;
// main.tsx hands in the app's state (stores stay out of this module)
export const setSnapshot = (f: () => unknown) => (snapshot = f);

async function build(note: string): Promise<string> {
  sampleHeap();
  const m = memory();
  const storage = await navigator.storage?.estimate?.().catch(() => undefined);
  const sw = navigator.serviceWorker?.controller;
  let app: unknown;
  try {
    app = snapshot();
  } catch (e) {
    app = { error: text(e) }; // a broken store must not stop the report
  }
  const body = {
    v: 1,
    at: new Date().toISOString(),
    note,
    url: scrub(location.href),
    build: [...document.scripts].map((s) => s.src).find((s) => s.includes("/assets/main-")) ?? "dev",
    uptimeMs: Date.now() - started,
    env: {
      ua: navigator.userAgent,
      lang: navigator.language,
      viewport: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
      cores: navigator.hardwareConcurrency,
      online: navigator.onLine,
      visible: !document.hidden,
      heapMB: m && { used: Math.round(m.usedJSHeapSize / 2 ** 20), limit: Math.round(m.jsHeapSizeLimit / 2 ** 20) },
      storageMB: storage && { used: Math.round((storage.usage ?? 0) / 2 ** 20), quota: Math.round((storage.quota ?? 0) / 2 ** 20) },
      serviceWorker: sw ? `${sw.scriptURL} ${sw.state}` : "none",
      frames: frameType || "unsupported",
    },
    app,
    ...buf,
  };
  return JSON.stringify(body).replace(TOKEN, "[token]");
}

// What goes with a report, in counts, for the button's panel
export const contents = () =>
  `${buf.logs.length} log lines, ${buf.errors.length} errors, ${buf.frames.length} slow frames, ${buf.net.length} requests, the app's state (no document text)`;

export async function sendReport(note: string): Promise<boolean> {
  if (state.sending) return false;
  set({ sending: true, sent: "", error: "" });
  try {
    const body = await build(note);
    const t = await token();
    if (!t) throw new Error("Sign in with GitHub to send a report, or download it.");
    const res = await realFetch(`${HUB}/report`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${t}` }, body });
    if (!res.ok) throw new Error((await res.text()).trim() || `The report server answered ${res.status}`);
    const { id } = (await res.json()) as { id: string };
    set({ sent: id, problems: 0 });
    return true;
  } catch (e) {
    set("error", e instanceof TypeError ? "Couldn't reach the report server. Download the report and send it to us instead." : e instanceof Error ? e.message : String(e));
    return false;
  } finally {
    set("sending", false);
  }
}

export async function downloadReport(note: string) {
  const body = await build(note);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type: "application/json" }));
  a.download = `red-letter-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export const resetReport = () => set({ sent: "", error: "" });
