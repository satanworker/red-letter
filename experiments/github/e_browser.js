// E/D in a real browser (headless Chromium, page origin https://example.com).
// Paste into DevTools on any https page after `const token = "<gh auth token>"`; needs refs/heads/spike/cas to exist.
// Observed output: e_browser.out
(async (token) => {
  const R = "https://api.github.com/repos/satanworker/red-letter";
  const H = { authorization: `Bearer ${token}` };
  const out = [];
  const get = async (label, init = {}) => {
    const t = performance.now();
    const r = await fetch(`${R}/git/ref/heads/spike/cas`, { headers: H, ...init });
    const j = r.status === 200 ? await r.json() : null;
    out.push({ label, status: r.status, sha: j?.object?.sha?.slice(0, 8), etag: r.headers.get("etag"), rem: r.headers.get("x-ratelimit-remaining"), ms: Math.round(performance.now() - t) });
    return j?.object?.sha;
  };
  const cur = await get("default #1");
  await get("default #2 (within 60s)");
  const c = await (await fetch(`${R}/git/commits/${cur}`, { headers: H })).json();
  const nc = await (await fetch(`${R}/git/commits`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ message: "browser probe", tree: c.tree.sha, parents: [cur] }) })).json();
  const p = await fetch(`${R}/git/refs/heads/spike/cas`, { method: "PATCH", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ sha: nc.sha, force: false }) });
  out.push({ label: "browser PATCH", status: p.status, new: nc.sha.slice(0, 8) });
  await get("default after PATCH");
  await get("cache:'no-cache' after PATCH", { cache: "no-cache" });
  await get("cache:'no-store' after PATCH", { cache: "no-store" });
  await get("default again");
  await get("manual If-None-Match + no-store", { cache: "no-store", headers: { ...H, "if-none-match": out.at(-1).etag } });
  const probe = async (label, url, init) => { try { out.push({ label, status: (await fetch(url, init)).status }); } catch (e) { out.push({ label, error: String(e) }); } };
  await probe("raw w/ auth", "https://raw.githubusercontent.com/satanworker/red-letter/main/docs/DESIGN.md", { headers: H });
  await probe("raw no auth", "https://raw.githubusercontent.com/satanworker/red-letter/main/docs/DESIGN.md");
  await probe("oauth token", "https://github.com/login/oauth/access_token", { method: "POST", headers: { accept: "application/json" } });
  console.table(out);
})(token);
