# GitHub integration (2025–2026): auth, commits, webhooks

Observed from GitHub docs (`X-GitHub-Api-Version: 2026-03-10`) unless marked `[INFERENCE]`.

## 1. Auth: use a GitHub App (not OAuth App, not PAT)

GitHub prefers Apps: fine-grained perms, short-lived tokens, one webhook for every installed repo, rate limits that scale. OAuth Apps use broad scopes, always act as the user, and need per-repo webhooks that are not cleaned up on revoke. Fine-grained PATs are for a person/script (max 50/user, one owner, org approval); they die if the user loses access. Classic PATs are worse (`repo` = every repo).

**Two tokens, one App:**

| Job | Token | How |
|---|---|---|
| Webhooks, read private blobs, ingest agent `git push` | Installation (`ghs_`) | JWT → `POST /app/installations/{id}/access_tokens` (1h). Optional `repositories`/`permissions` (≤500 repos). |
| Sign-in, commit as the user, only repos they can write | User-to-server (`ghu_`) | Web OAuth flow. Token = **intersection** of App perms **and** the user’s access. Repo A (App only) and C (user only) are both invisible; only B (both) works. |

Do **not** use the installation token for user saves: it can write any installed repo even if that user cannot. Check access with `GET /user/installations` and `GET /user/installations/{id}/repositories`.

**App perms:** Contents R/W, Pull requests W, Metadata R. Account: Email addresses R (for trailers). Events: `push`, `installation`, `github_app_authorization` (cannot unsubscribe; stop using revoked tokens).

Turn on **Request user authorization (OAuth) during installation**. Org install still requires each other member to authorize for user tokens. SAML orgs need an active SAML session before re-auth.

**OAuth App / PAT:** skip for this product.

## 2. Git Data API vs Contents API

**Contents** `PUT /repos/{owner}/{repo}/contents/{path}`: one file → one commit. Body: `message`, base64 `content`, `sha` (required on update), optional `branch`/`author`/`committer`. GET: ≤1 MB full JSON; 1–100 MB raw/object only (`content` empty); **>100 MB unsupported**. Dir listing cap 1,000. Empty-repo bootstrap: this endpoint (Git Data returns **409** on empty/unavailable repos).

**Git Data (use this):** atomic multi-file, CAS on the ref.

1. `GET /repos/{o}/{r}/git/ref/heads/{branch}`
2. `POST .../git/blobs` (`content`, `encoding`: `utf-8`\|`base64`)
3. `POST .../git/trees` (`base_tree`, `tree[]`; `sha: null` deletes; `content` or `sha`, not both)
4. `POST .../git/commits` (`message`, `tree`, `parents`)
5. `PATCH .../git/refs/heads/{branch}` `{ sha, force: false }` — non-FF → 422; rebase/retry. `force: true` is a force-push.

Blob **GET** supports **100 MB**. Recursive trees: **100k entries / 7 MB**, `truncated: true` → walk subtrees. `[INFERENCE]` create-blob is bounded by the same ~100 MB GET limit; Contents PUT is the 1 MB JSON path.

**Rate limits:** installation 5,000/h (GHEC 15,000); non-GHEC scales +50/repo over 20 and +50/user over 20, cap **12,500**. User tokens share the user’s **5,000/h** (15,000 if GHEC-owned App) with PATs/other apps. Secondary: 100 concurrent; REST 900 points/min (most POST/PUT = 5); **≤80 content-creating req/min, ≤500/h**. Pause ≥1s between mutative calls. Headers `x-ratelimit-*` beat `GET /rate_limit`.

## 3. Commit attribution / verified

- **User token, no custom author/committer:** GitHub attributes the commit to that user. API commits are **not** web-UI GPG-signed (`github.com/web-flow.gpg`). Unsigned. Protected “require signed commits” will reject them.
- **Installation token, no custom author/committer/signature:** GitHub auto-signs as `AppName[bot]` → **Verified**. Custom author/committer/signature **disables** bot verification.
- **`Co-authored-by: Name <email>`** in the message: GitHub UI co-authors + contribution graph iff the email is on their account. Prefer `{id}+{login}@users.noreply.github.com`. `on-behalf-of:` is org-verified-domain only.

**For this product:** user-to-server, omit author/committer. If a branch requires signed commits, commit on an unprotected draft branch, or accept bot-signed + `Co-authored-by` (user is co-author, not primary author).

## 4. Webhooks

- **No automatic retry.** 2xx within **10s** or it is failed. Queue work; ACK first.
- Payload cap **25 MB** → **no delivery**. `commits[]` **≤2048** (else Commits API). >5000 branches or >3 tags in one push: events omitted.
- Push fields: `ref`, `before`, `after`, `created`/`deleted`/`forced`, `head_commit`, `compare`, `pusher`, `installation`. Commit objects include path lists `added`/`removed`/`modified` and `tree_id` (GitHub/Octokit push schema). **No per-file blob SHAs.** Fetch `GET /repos/{o}/{r}/commits/{sha}` → `files[].sha` / `filename` / `status`, or `GET .../git/trees/{tree}?recursive=1`.
- Verify `X-Hub-Signature-256`. Dedup `X-GitHub-Delivery` (redelivery reuses the id).
- Recent deliveries **3 days**. App: `GET /app/hook/deliveries`, `POST /app/hook/deliveries/{id}/attempts` (JWT).
- **Polling fallback:** `GET .../git/ref/heads/{branch}` with `If-None-Match` (304 does not count). Then `GET .../compare/{before}...{after}` — docs cap **~250 commits / ~300 files**; if truncated, walk commits/trees. Ignore your own pushes (`after` already applied, or `pusher` is the App/user).

## 5. Draft branch → PR

```
POST /repos/{o}/{r}/git/refs     { "ref": "refs/heads/draft/…", "sha": "<base>" }
POST /repos/{o}/{r}/pulls        { "title", "head", "base", "draft": true }
PUT  /repos/{o}/{r}/pulls/{n}/merge
```

No refs on empty repos. Draft PRs need GitHub Team/Enterprise for **private** repos (Free = public only). `merge` refs go stale unless you GET/create/edit the PR first.

## 6. Sign-in / refresh

Web app flow (PKCE `S256` only; `plain` unsupported):

1. `GET https://github.com/login/oauth/authorize?client_id&redirect_uri&state&code_challenge&code_challenge_method=S256`
2. `POST https://github.com/login/oauth/access_token` (`client_id`, `client_secret`, `code`, `code_verifier`)

Default (new Apps): access **8h** (`expires_in=28800`, `ghu_`), refresh **6 months** (`15897600`, `ghr_`). Refresh: `grant_type=refresh_token` — **old access + refresh die**. Test with `scope=offline_access` (only App “scope”). `scope` in the token response is always `""`. Optional `repository_id` further restricts. Device flow is for CLIs, not this web app.

**2026 token format:** installation tokens rolling out as `ghs_` JWTs (~520 chars, two dots). Do not assume 40-char opaque tokens. Regex: `ghs_[A-Za-z0-9\.\-_]{36,}`. GHEC/dotcom; not GHES. Header `X-GitHub-Stateless-S2S-Token: enabled|disabled` is temporary.

**Libs:** `@octokit/app` 16.1.x, `@octokit/rest` 22.x, `@octokit/webhooks` 14.2.x, `@octokit/auth-app` (auto-refreshes installation tokens).

## Gotchas

1. User token ∩ installation: must install **and** authorize.
2. Installation token bypasses the signed-in user’s ACL.
3. Own `push` webhook echo after every save.
4. Empty repo → Git Data 409; Contents PUT first.
5. `force: false` is the only safe CAS; concurrent browser+agent needs replay-as-CRDT then retry.
6. Signed-commit branch protection vs unsigned user-token API commits.
7. Custom author on App token → Unverified.
8. Secondary **content-creation** limits will bite idle-autosave more than the 5k primary.
9. 25 MB / 2048-commit / 300-file compare truncation: always follow `before`/`after` with trees/blobs.
10. No auto webhook retry; 10s ACK; 3-day delivery log.
11. SAML SSO; org App approval; `github_app_authorization` revoke → 401.
12. Installation token length change (2026).
13. Workflow files need extra Workflows permission.
14. `[INFERENCE]` idle-save loops will 409 without per-(repo,branch) serialization.

## Recommendation

Ship **one GitHub App**. Install for webhooks + private reads (installation token); OAuth web flow + PKCE for sign-in (user token, 8h/6mo refresh). Commit with **Git Data** blob→tree→commit→`PATCH ref force:false` on the user token so GitHub attributes the signed-in user and you get a single atomic commit; Contents PUT only to init empty repos or tiny one-file edits. Ingest agent pushes from the App `push` webhook using `before`/`after`, then `GET compare` / `GET commits/{sha}` / `GET git/blobs/{sha}` (≤100 MB) to replay into the CRDT; poll `GET git/ref` + `If-None-Match` as the missed-delivery fallback. Drafts: `POST git/refs` + `POST pulls` with `draft: true`. Keep comments off-git. Keep author/committer unset on user-token commits; don’t fight signed-commit protection on `main`—use draft branches.

### Primary links

- https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app
- https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-your-git-database
- https://docs.github.com/en/rest/git/blobs
- https://docs.github.com/en/rest/git/trees
- https://docs.github.com/en/rest/git/commits
- https://docs.github.com/en/rest/git/refs
- https://docs.github.com/en/rest/repos/contents
- https://docs.github.com/en/rest/commits/commits
- https://docs.github.com/en/rest/pulls/pulls
- https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification
- https://docs.github.com/en/pull-requests/how-tos/commit-changes/creating-a-commit-with-multiple-authors
- https://docs.github.com/en/webhooks/webhook-events-and-payloads
- https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries
- https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks
- https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
- https://github.blog/changelog/2026-05-15-github-app-installation-tokens-per-request-override-header/
