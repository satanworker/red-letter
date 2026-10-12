// Tiny GitHub REST/GraphQL helper for spikes. Token from `gh auth token`.
import { execSync } from "node:child_process";

export const TOKEN = process.env.GH_TOKEN || execSync("gh auth token").toString().trim();
export const REPO = "satanworker/red-letter";
export const R = `/repos/${REPO}`;

const RL = ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-used", "x-ratelimit-resource"];

export async function api(method, path, body, extraHeaders = {}) {
  const t0 = performance.now();
  const res = await fetch(path.startsWith("http") ? path : `https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(body ? { "content-type": "application/json" } : {}),
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ms = Math.round(performance.now() - t0);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  const rl = Object.fromEntries(RL.map((h) => [h.replace("x-ratelimit-", ""), res.headers.get(h)]));
  return { status: res.status, ms, json, text, headers: res.headers, rl, etag: res.headers.get("etag") };
}

export const gql = (query, variables, extraHeaders) =>
  api("POST", "/graphql", { query, variables }, extraHeaders);

export function ok(r, label) {
  if (r.status >= 300) throw new Error(`${label}: ${r.status} ${r.text.slice(0, 300)}`);
  return r.json;
}

export const log = (...a) => console.log(...a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))));

// blob -> tree(base_tree) -> commit; returns { commit, calls }
export async function makeCommit(parent, baseTree, files, message) {
  const timings = [];
  const tree = [];
  for (const [path, content] of Object.entries(files)) {
    const b = await api("POST", `${R}/git/blobs`, { content, encoding: "utf-8" });
    timings.push(["blob", b.status, b.ms]);
    tree.push({ path, mode: "100644", type: "blob", sha: ok(b, "blob").sha });
  }
  const t = await api("POST", `${R}/git/trees`, baseTree ? { base_tree: baseTree, tree } : { tree });
  timings.push(["tree", t.status, t.ms]);
  const c = await api("POST", `${R}/git/commits`, {
    message, tree: ok(t, "tree").sha, parents: parent ? [parent] : [],
  });
  timings.push(["commit", c.status, c.ms]);
  return { commit: ok(c, "commit"), timings };
}
