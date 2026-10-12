// D: conditional polling, rate-limit accounting, freshness after PATCH.
import { api, ok, log, R } from "./lib.mjs";

const REF = `${R}/git/ref/heads/spike/cas`;
const H = (r) => ({ s: r.status, ms: r.ms, etag: r.etag, cc: r.headers.get("cache-control"), vary: r.headers.get("vary"), lm: r.headers.get("last-modified"), rem: r.rl.remaining, used: r.rl.used, res: r.rl.resource });

let r = await api("GET", REF);
log("200 first", H(r));
const etag = r.etag;
for (let i = 0; i < 3; i++) log(`304? #${i}`, H(await api("GET", REF, null, { "if-none-match": etag })));
log("plain 200 again", H(await api("GET", REF)));
// weak vs strong: send without W/ prefix
log("etag w/o W/ prefix", H(await api("GET", REF, null, { "if-none-match": etag.replace(/^W\//, "") })));

// commits/{branch} sha variant
const C = `${R}/commits/spike/cas`;
r = await api("GET", C, null, { accept: "application/vnd.github.sha" });
log("commits sha 200", H(r), "body", r.text);
const cetag = r.etag;
log("commits sha 304?", H(await api("GET", C, null, { accept: "application/vnd.github.sha", "if-none-match": cetag })));

// Freshness: PATCH ref, then immediately poll with the old etag (conditional) and unconditional.
const cur = ok(await api("GET", REF), "ref").object.sha;
const tree = ok(await api("GET", `${R}/git/commits/${cur}`), "c").tree.sha;
const next = ok(await api("POST", `${R}/git/commits`, { message: "poll probe", tree, parents: [cur] }), "c").sha;
const old = await api("GET", REF);
const p = await api("PATCH", `${R}/git/refs/heads/spike/cas`, { sha: next, force: false });
const tPatch = performance.now();
log("PATCH", p.status, "new etag in PATCH response", p.etag);
for (let i = 0; i < 6; i++) {
  const c = await api("GET", REF, null, { "if-none-match": old.etag });
  const u = await api("GET", REF);
  const uc = await api("GET", C, null, { accept: "application/vnd.github.sha", "if-none-match": cetag });
  log(`t+${Math.round(performance.now() - tPatch)}ms`, "cond:", c.status, c.json?.object?.sha === next,
    "| uncond:", u.status, u.json.object.sha === next, "| commits-sha cond:", uc.status, uc.text === next);
  await new Promise((s) => setTimeout(s, 1000));
}
log("rate after", (await api("GET", "/rate_limit")).json.resources.core);
