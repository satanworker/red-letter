# GitHub API spike (DESIGN.md spikes #2, #3)

Run 2026-10-12 against `satanworker/red-letter` with a classic PAT (`repo`). Raw output for every row is in the matching `*.out` file next to the script. All created refs were deleted; `git ls-remote` afterwards shows only `HEAD` and `refs/heads/main` at `b76867d` (the original sha), see `cleanup.out`.

Env note: SSH to github.com was refused in this sandbox (`Permission denied (publickey)`), so git ops used `https://x-access-token:$(gh auth token)@github.com/...`.

## Design-breaking surprises

1. **REST `PATCH /git/refs/...` with `force:false` does not check fast-forward on non-branch refs.** Moving `refs/red-letter/spike-cas/doc` to an unrelated root commit returned **200** and the ref moved. The same call on `refs/heads/spike/cas` returned 422 (`b3_cas_semantics.out` 1, 1b). Using REST for the CRDT ref lets the last writer win silently.
2. **GraphQL `updateRefs` updates several refs atomically and does real compare-and-swap.** Each update carries a `beforeOid` that must equal the current value, and fast-forward is enforced unless `force:true` is set. The branch and the CRDT ref can move in one atomic call. DESIGN.md step 6 ("then update the CRDT ref") should become one `updateRefs`.
3. **A stale `beforeOid` comes back as an opaque error.** The response is HTTP 200 with `{"errors":[{"message":"Something went wrong while executing your query…"}]}`: no `type`, no `data`. Nothing moved in any of the cases tested. The client has to treat *any* `updateRefs` error as "conflict: re-read refs, replay, retry".
4. **The browser HTTP cache serves stale refs for up to 60 s, even after your own write.** The cause is `cache-control: private, max-age=60`. With default `fetch()`, the first GET after a browser-side PATCH returned the **old sha** in 4 ms from cache (`e_browser.out`). Polls must use `cache:"no-cache"` (the browser revalidates with ETag on its own) or `cache:"no-store"` with a manual `If-None-Match`.
5. **`refs/red-letter/<branch>/<path>` collides.** Branch `a` + path `b/c.md` and branch `a/b` + path `c.md` map to the same ref. On top of that, D/F conflicts block `x/docs` next to `x/docs/a.md` (see C). Use the hashed naming in C instead.
6. **`raw.githubusercontent.com` can't be called with `Authorization` from a browser:** the preflight gets 403. Private-repo reads must go through `api.github.com`.

## A. CAS commit sequence (Git Data API) — `a_cas.mjs`, `a_latency.mjs`

| step | result |
|---|---|
| blob → tree(base_tree) → commit → PATCH `{force:false}` | 201/201/201/200; 425+378+363+752 ms = **1920 ms, 4 calls** |
| tree with inline `content` (no blob call) → commit → PATCH | 201/201/200, **3 calls**. 5 runs (client keeps head+tree, no re-reads): totals 2292/1648/1628/1799/1355 ms; median tree 564, commit 464, PATCH 674, **total 1648 ms** |
| concurrent writer: A and B both built on the same parent; A PATCH | 200 |
| B PATCH | **422** `{"message":"Update is not a fast forward","status":"422"}` |
| retry: GET ref → GET commit (tree) → rebuild on new head → PATCH | 200 (total 5 calls on the retry path: 2 reads + 3 writes) |
| PATCH to the sha it already points at | 200 (no-op) |

Calls per commit: **3 writes** (tree with inline content, commit, PATCH) when the client remembers `head`+`tree` from its last save or poll. Otherwise add GET ref and GET commit. Binary content needs a separate `POST /git/blobs {encoding:"base64"}`. Inline tree `content` is a UTF-8 string ([INFERENCE] from the API shape; binary was only tested via blobs).

Semantics: REST `force:false` on `refs/heads/*` is a **fast-forward check, not a CAS**. A PATCH succeeds whenever the new commit descends from the *current* head. Because every client builds on the head it last saw, that works as optimistic concurrency in practice.

## B. Atomic file + CRDT update — `b_atomic.mjs`, `b2_followup.mjs`, `b3_cas_semantics.mjs`, `b4_force_cas.mjs`

| question | result |
|---|---|
| CRDT ref → commit whose tree holds `doc.automerge` (binary) + `meta.json {commit_sha, path}` | 201. Binary blob round-trips byte-exact via base64 |
| Multi-ref atomic API? | **Yes: GraphQL `updateRefs(input:{repositoryId, refUpdates:[{name, beforeOid, afterOid, force}]})`.** Schema description: "All updates are performed atomically, meaning that if one of them is rejected, no other ref will be modified." `beforeOid` of 40 zeros = must not exist; `afterOid` of 40 zeros = delete |
| updateRefs: branch + CRDT ref, both `beforeOid` correct | 200 `{"data":{"updateRefs":{…}}}`, **716 ms**, both refs moved |
| updateRefs: branch correct, CRDT `beforeOid` stale | 200 `{"errors":[{"message":"Something went wrong…"}]}`. **Neither ref moved** (verified with a GET on each) |
| updateRefs: one update non-FF, `force` omitted | `{"type":"UNPROCESSABLE","message":"rejecting non-fast forward update"}`. Nothing moved (repeated 2×) |
| updateRefs: stale-but-ancestor `beforeOid` with an FF `afterOid` (custom ref and branch) | opaque "Something went wrong", **not moved**. `beforeOid` is a true CAS, not just an FF check |
| updateRefs: `force:true` + stale `beforeOid` | opaque error, not moved. CAS holds even with force, so parentless CRDT snapshots (no history growth) are safe |
| updateRefs create with `beforeOid`=zeros on an existing ref / a new ref / delete via afterOid=zeros | opaque error / created (GET 200) / deleted (GET 404) |
| bogus `beforeOid` sha | `{"type":"UNPROCESSABLE","message":"twirp error not_found: missing"}` |
| REST option: PATCH file ref (200), then PATCH CRDT ref | file ref already moved, and the CRDT PATCH is not FF-checked (surprise 1). On partial failure the branch is ahead of the CRDT's `meta.commit_sha`. That is recoverable through the step-3 replay, but REST can also silently overwrite another tab's CRDT snapshot |
| `createCommitOnBranch` (single branch, `expectedHeadOid`) | 200, 1153 ms. Stale → `{"type":"STALE_DATA","message":"Expected branch to point to \"3d0b…\" but it did not.  Pull and try again."}`. Single branch, so it can't cover the CRDT ref |

Call count for file commit + CRDT update:
- **REST only:** tree, commit, PATCH (file) + blob, tree, commit, PATCH (CRDT) = **7 calls**. Not atomic, and the CRDT PATCH has no CAS.
- **updateRefs:** tree, commit (file) + blob, tree, commit (CRDT) + 1 GraphQL = **6 calls**, atomic with CAS on both refs.

## C. Custom refs `refs/red-letter/*` — `c_refs.mjs`, `c_git.sh`

| question | result |
|---|---|
| `POST /git/refs {ref:"refs/red-letter/main/x"}` | **201** |
| ref → blob sha (not a commit) | **201**. GET returns `object.type:"blob"`. `git fetch` brings it in as `objecttype blob` |
| `GET /git/ref/red-letter/main/x` | 200, `object.type:"commit"` |
| `GET /git/matching-refs/red-letter/` | 200, lists all of them (use it for "all CRDT refs of branch X" by prefix) |
| in `GET /branches`? | **No** (only `main`, `spike/cas`) |
| in `GET /git/refs`? | yes |
| `git ls-remote` | **yes**, all listed |
| default `git clone` → `for-each-ref` | **not fetched** (only heads + remotes/origin/*) |
| `git clone --mirror` | fetched (7/7) |
| explicit `git fetch origin 'refs/red-letter/*:refs/red-letter/*'` | works, all 7 |
| agent `git push origin spike/x` | custom refs untouched (still 7 on remote) |
| `git fetch --prune` (default refspec) | doesn't touch local `refs/red-letter/*` (still 7) |
| `git fetch --prune origin 'refs/red-letter/*:refs/red-letter/*'` after a remote delete | prunes it locally (`- [deleted] (none) -> refs/red-letter/main/x`) |
| `git push --mirror --dry-run` from a normal clone | **would delete every `refs/red-letter/*`** (and every branch not present locally). `--mirror` from a clone that has fetched them leaves them alone |
| invalid names | `sp ace`, `a..b`, `x.lock`, `~bad` → 422 `… is not a valid ref name.` `.md` and `%2F` accepted |
| `%` in a ref name | creatable, but REST `DELETE /git/refs/red-letter/feat%2Fx/a.md` → **422** (GitHub decodes `%2F` to `/`). It needs `%252F` (204). Avoid `%` |
| D/F: create `refs/red-letter/t/docs`, then `…/t/docs/a.md` | **422 `{"message":"Reference update failed"}`** |
| D/F reverse: `u/docs/a.md`, then `u/docs` | **422 `Reference update failed`** |
| duplicate create | 422 `Reference already exists` (distinct message, so usable as a lock signal) |

**Recommended naming:** `refs/red-letter/v1/<sha1hex(branch)>/<sha1hex(path)>`. Both components are fixed-length hex, so there are no D/F conflicts, no collisions between `a`+`b/c.md` and `a/b`+`c.md`, and no ref-name rules to escape. `matching-refs/red-letter/v1/<sha1hex(branch)>/` still lists the docs of one branch (draft copy). `meta.json` inside the CRDT commit carries the human-readable `{branch, path, commit_sha}`. The browser computes SHA-1 with `crypto.subtle.digest`.

## D. Polling — `d_poll.mjs`, `e_browser.js`

| question | result |
|---|---|
| `GET /git/ref/heads/spike/cas` | 200, `etag: W/"d86f…"`, `cache-control: private, max-age=60, s-maxage=60`, `vary: Accept, Authorization, Cookie, …`, `last-modified` present |
| same with `If-None-Match: <etag>` | **304** ×3. `x-ratelimit-remaining` stayed 4944 / used 56 on all three. The next unconditional 200 → 4943 / 57. **304s are free; 200s cost 1** |
| `If-None-Match` without the `W/` prefix | 304 too |
| `GET /commits/spike/cas` with `Accept: application/vnd.github.sha` | 200, body = 40-char sha, `etag: "<sha>"` (strong, equal to the commit sha). With If-None-Match → 304 |
| freshness after PATCH (Node, no HTTP cache) | first poll at **t+747 ms**: conditional poll with the old etag → 200 with the new sha. The unconditional ref GET and the commits-sha variant also had the new sha. No server-side staleness seen |
| freshness in a browser, default `fetch` | **stale**: second GET served from cache in 5 ms. After a browser PATCH, default GET still returned the old sha in 4 ms |
| browser `cache:"no-cache"` | 200 with the new sha in 390 ms (browser revalidates; JS sees 200 even when the network got a 304) |
| browser `cache:"no-store"` + manual `If-None-Match` | **304** visible to JS, 381 ms |

Recommendation: poll `GET /git/ref/heads/<branch>` with `cache:"no-store"` and a manual `If-None-Match` (JS sees 304 = unchanged and doesn't need to parse anything). `If-None-Match` is in `access-control-allow-headers` and `ETag` is exposed (E). At 15 s per open file, a 304 costs 0 core quota.

## E. CORS — `e_cors.sh`, `e_browser.js`

| endpoint | result |
|---|---|
| `OPTIONS api.github.com/repos/…/git/refs/heads/spike/cas` (PATCH; authorization, content-type, if-none-match) | **204**, `access-control-allow-origin: *`, `allow-methods: GET, POST, PATCH, PUT, DELETE`, `allow-headers: Authorization, Content-Type, If-Match, If-Modified-Since, If-None-Match, If-Unmodified-Since, Accept-Encoding, X-GitHub-OTP, X-Requested-With, User-Agent, GraphQL-Features, X-Github-Next-Global-ID, X-GitHub-Api-Version, …`, `max-age: 86400` |
| `access-control-expose-headers` | `ETag, Link, Location, Retry-After, X-GitHub-OTP, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Used, X-RateLimit-Resource, X-RateLimit-Reset, X-OAuth-Scopes, X-Accepted-OAuth-Scopes, X-Poll-Interval, X-GitHub-Media-Type, X-GitHub-SSO, X-GitHub-Request-Id, …`. **ETag and all x-ratelimit-\* are exposed** |
| `OPTIONS api.github.com/graphql` (POST) | 204, same headers, so `updateRefs` works from the browser |
| real browser (Chromium, origin https://example.com): GET, POST commit, PATCH ref | all 200 |
| `github.com/login/oauth/access_token` | OPTIONS **404**, no ACAO. Browser POST → `TypeError: Failed to fetch`. **Needs the exchange function** (as designed) |
| `raw.githubusercontent.com` OPTIONS with `Authorization` | **403** (with ACAO `*`). Browser fetch with auth → `Failed to fetch`. Without auth: 200 (this repo is public). Private repos can't use raw from the browser |

## F. Reading the file — `f_read.mjs` (small = 19 B, big = 1,258,334 B)

| method | small | big (1.2 MB) |
|---|---|---|
| `GET /contents/{path}?ref=` (default json) | 200, base64 `content`, equal | 200, **`encoding:"none"`, `content:""`**. Files over 1 MB have no inline content |
| `/contents` with `Accept: application/vnd.github.raw+json` | 200, raw bytes equal, `etag: "<blob sha>"` | 200, raw bytes equal, 250 ms |
| `/contents` with `…object+json` | base64 | `encoding:"none"`, empty |
| `GET /git/blobs/{sha}` (json) | 200 base64 equal, **`cache-control: private, max-age=86400`** (immutable by sha) | 200 base64 equal, 284 ms |
| `/git/blobs/{sha}` with raw Accept | equal | equal |
| `raw.githubusercontent.com/<o>/<r>/<branch>/<path>` | 200, `cache-control: max-age=300`, no rate-limit headers | 200, equal. **Cached 5 min by branch name** → stale after writes |
| write of the 1.2 MB blob | `POST /git/blobs` 201 in 1465 ms | |

Size limits per GitHub docs (not hit here): contents JSON inlines ≤1 MB, raw/object media types up to 100 MB, blobs API up to 100 MB. Recommendation: `GET /contents/{path}?ref=<commit sha>` with `Accept: application/vnd.github.raw+json` (one call, any size up to 100 MB, ETag = blob sha). Or `GET /git/blobs/{sha}` when the blob sha is already known from a tree (cacheable for 24 h).

## G. Rate limits — `g_rate.mjs`, `d_poll.out`

| observation | value |
|---|---|
| core REST headers | `x-ratelimit-limit: 5000`, `-remaining`, `-used`, `-reset`, `x-ratelimit-resource: core` on every response, 304s included |
| 304 conditional | does not increment `used` (D) |
| GraphQL headers | `x-ratelimit-resource: graphql`, limit 5000, `rateLimit{cost}` = 1 for a simple query. Header said used 24 while `/rate_limit` reported `graphql: 6/5000` a moment later (inconsistent accounting, not investigated) |
| `/rate_limit` | not counted (`used` unchanged at 90) |
| secondary limits | no header shows them before you trip one. Docs: ~80 content-creating requests/min, 500/hour, and `retry-after` / 403/429 when hit. `Retry-After` is CORS-exposed |
| budget per save | 3 writes (file only) / 5 writes + 1 GraphQL (file + CRDT). Saving on 30 s idle stays under 80/min per user unless one user has many tabs saving |

Quota is per user, so a PAT shared across concurrent agents saw `used` jump between our calls. For GitHub App user-to-server tokens the limits differ ([INFERENCE]: 5000/h/user, more for Enterprise Cloud). Whether `updateRefs` is allowed for App user tokens with `contents:write` is untested ([INFERENCE] likely, since it's a regular mutation).

## H. Comments on an orphan branch — `h_comments.mjs`

| step | result |
|---|---|
| blob → tree (no base_tree) → commit `parents:[]` | 201×3, commit has 0 parents |
| `POST /git/refs refs/heads/spike/red-letter-comments` | 201 |
| append c2: GET ref, GET contents raw, GET commit (tree), blob, tree, commit, PATCH `force:false` | PATCH 200 |
| stale appender built on the old head | **422 Update is not a fast forward** |
| agent: `git fetch origin spike/red-letter-comments && git show FETCH_HEAD:main/spike/cas.md.json` | works: c1, c2 (parent c1); `git log FETCH_HEAD` = 2 commits |
| agent after a plain `git fetch` | `git show origin/spike/red-letter-comments:…` works (it's a normal branch, fetched by default and listed in `/branches`) |

## Recommended browser save sequence

Precondition: the client holds `head` (branch sha), `headTree`, `crdtHead` from the last load, poll or save.

```
1. POST /repos/{o}/{r}/git/trees    {base_tree: headTree, tree:[{path, mode:"100644", type:"blob", content: markdown}]}
2. POST /repos/{o}/{r}/git/commits  {message, tree: <1>, parents:[head]}          → fileCommit
3. POST /repos/{o}/{r}/git/blobs    {content: base64(Automerge.save(doc)), encoding:"base64"}
4. POST /repos/{o}/{r}/git/trees    {tree:[{path:"doc.automerge", sha:<3>}, {path:"meta.json", content: JSON{branch,path,commit_sha:fileCommit,heads}}]}
5. POST /repos/{o}/{r}/git/commits  {message, tree:<4>, parents:[]}              → crdtCommit (parentless snapshot; old ones get GC'd)
6. POST /graphql updateRefs(refUpdates:[
     {name:"refs/heads/<branch>", beforeOid: head, afterOid: fileCommit},
     {name:"refs/red-letter/v1/<sha1(branch)>/<sha1(path)>", beforeOid: crdtHead, afterOid: crdtCommit, force:true}])
   any `errors` → GET /git/ref/heads/<branch> + GET /git/ref/red-letter/…, replay at heads, rebuild 1–6.
```

Total: 5 REST + 1 GraphQL, about 2–3 s. CRDT ref creation (DESIGN step 2): `POST /git/refs` → 422 `Reference already exists` means someone else won. `updateRefs` with `beforeOid` of zeros also works but its error is opaque. Poll: `GET /git/ref/heads/<branch>`, `cache:"no-store"`, `If-None-Match`. Read file: `GET /contents/{path}?ref=<sha>` with `Accept: application/vnd.github.raw+json`.

Content-creating calls used across all scripts: roughly 130 (under the 150 budget).
