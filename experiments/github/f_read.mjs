// F: reading a file: contents (json/raw/object), git/blobs, raw.githubusercontent.
import { api, ok, log, R, TOKEN, makeCommit } from "./lib.mjs";

const BR = "spike/read";
const main = ok(await api("GET", `${R}/git/ref/heads/main`), "main").object.sha;
const mainTree = ok(await api("GET", `${R}/git/commits/${main}`), "c").tree.sha;
const line = "Lorem ipsum dolor sit amet, consectetur adipiscing elit — ünïcødé ✓.\n";
const big = line.repeat(Math.ceil(1.2 * 1024 * 1024 / Buffer.byteLength(line)));
const files = { "spike/small.md": "# small\n\nhello ✓\n", "spike/big.md": big };
const { commit, timings } = await makeCommit(main, mainTree, files, "spike: read test");
log("write", timings, "big bytes", Buffer.byteLength(big));
log("create branch", (await api("POST", `${R}/git/refs`, { ref: `refs/heads/${BR}`, sha: commit.sha })).status);

for (const path of Object.keys(files)) {
  const want = Buffer.from(files[path]);
  let r = await api("GET", `${R}/contents/${path}?ref=${BR}`);
  const j = r.json;
  log(path, "contents(json)", r.status, r.ms, "ms", { size: j.size, encoding: j.encoding, contentLen: j.content?.length, sha: j.sha,
    equal: j.content ? Buffer.from(j.content, "base64").equals(want) : null, cc: r.headers.get("cache-control") });
  r = await api("GET", `${R}/contents/${path}?ref=${BR}`, null, { accept: "application/vnd.github.raw+json" });
  log(path, "contents(raw)", r.status, r.ms, "ms", "equal", Buffer.from(r.text).equals(want), "etag", r.etag, "ct", r.headers.get("content-type"));
  r = await api("GET", `${R}/contents/${path}?ref=${BR}`, null, { accept: "application/vnd.github.object+json" });
  log(path, "contents(object)", r.status, r.ms, "ms", { encoding: r.json.encoding, contentLen: r.json.content?.length });
  r = await api("GET", `${R}/git/blobs/${j.sha}`);
  log(path, "git/blobs(json)", r.status, r.ms, "ms", { size: r.json.size, encoding: r.json.encoding, equal: Buffer.from(r.json.content, "base64").equals(want), cc: r.headers.get("cache-control") });
  r = await api("GET", `${R}/git/blobs/${j.sha}`, null, { accept: "application/vnd.github.raw+json" });
  log(path, "git/blobs(raw)", r.status, r.ms, "ms", "equal", Buffer.from(r.text).equals(want), "rem", r.rl.remaining);
  const t0 = performance.now();
  const raw = await fetch(`https://raw.githubusercontent.com/satanworker/red-letter/${BR}/${path}`, { headers: { authorization: `token ${TOKEN}` } });
  const body = Buffer.from(await raw.arrayBuffer());
  log(path, "raw.githubusercontent", raw.status, Math.round(performance.now() - t0), "ms", "equal", body.equals(want), "cc", raw.headers.get("cache-control"), "ratelimit hdr", raw.headers.get("x-ratelimit-remaining"));
}
