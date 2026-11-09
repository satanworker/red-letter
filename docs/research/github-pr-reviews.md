# 🔍 GitHub pull request reviews: how they work in 2026

Research for the branches + review flow (2026-11-09): can Red Letter's margin comments become PR review comments? Primary links per claim; `[UNVERIFIED]` where the agent couldn't confirm. Decisions drawn from it are in `docs/DESIGN.md` (Branches and reviews).

Facts as of 2026-11-09. API version in current REST docs: `2026-03-10`. `x_search` did not return posts (synthesized, incorrect API summary); no X citations.

---

### 1. `POST /repos/{owner}/{repo}/pulls/{pull_number}/comments`

Docs: https://docs.github.com/en/rest/pulls/comments

**Required today:** `body`, `commit_id`, `path`. `line` is required **unless** `subject_type: file`. `side` / `start_line` / `start_side` are **not** required for a single-line comment. `start_line` + `start_side` **are** required for multi-line (unless `in_reply_to`).

| Field | Status |
|---|---|
| `body` | required |
| `commit_id` | required (stale SHA → comment may render outdated) |
| `path` | required |
| `line` | required unless `subject_type: file`; last line of a multi-line range |
| `side` | optional `LEFT`/`RIGHT`; default `RIGHT`. Docs: RIGHT = additions **or unchanged context lines shown in the diff** |
| `start_line` / `start_side` | multi-line only |
| `subject_type` | optional `line` \| `file` |
| `in_reply_to` | if set, **all other body params except `body` are ignored** |
| `position` | **yes, closing down / deprecated.** “If you use `position`, `line`/`side`/`start_line`/`start_side` are not required.” GraphQL `position`/`originalPosition` also marked deprecated, removal dated 2023-10-01 (still in schema): https://docs.github.com/en/graphql/reference/pulls |

**`line` outside the unified diff (unchanged, outside hunk context): no.** REST still treats comments as “on a portion of the unified diff.”

**422 text** (from live GitHub API, not the docs page):  
`pull_request_review_thread.line must be part of the diff`  
plus `pull_request_review_thread.diff_hunk` / `missing_field`  
https://github.com/cloudflare/pint/issues/919  
Same wording: https://github.com/hubtty/hubtty/issues/74

**`subject_type: file`:** yes, file-level comments. `line` not required. GA + REST/GraphQL: https://github.blog/changelog/2023-04-11-commenting-on-files-in-a-pull-request-is-now-generally-available/  
GraphQL enum `FILE` / `LINE`: https://docs.github.com/en/graphql/reference/pulls (`PullRequestReviewThreadSubjectType`)

---

### 2. Unchanged lines after expanding context

**Web UI: yes.** Expand the diff, click `+` on any line of a **changed** file (not unchanged files). Public preview 2025-09-25: https://github.blog/changelog/2025-09-25-pull-request-files-changed-public-preview-now-supports-commenting-on-unchanged-lines/  
Default Files changed experience 2026-01-22: https://github.blog/changelog/2026-01-22-improved-pull-request-files-changed-page-on-by-default/  
Mobile 2026-02-03: https://github.blog/changelog/2026-02-03-github-mobile-comment-on-unchanged-lines-in-pull-request-files/  
Staff discussion: https://github.com/orgs/community/discussions/174786

**API create: still limited.** GitHub: “API support is currently limited, but comments on unchanged lines will be **returned** by existing APIs and webhooks.” Same changelog + discussion. Classic 3-line hunk context **is** in the unified diff (`side: RIGHT` for white context) and **is** API-legal. Lines only visible after expanding beyond the hunk are not.

**Workarounds that actually work:** `subject_type: file`; or an issue comment with a permalink. GraphQL `addPullRequestReviewThread` (`path`+`line`, no `position`) is **proposed** as a workaround in https://github.com/github/github-mcp-server/issues/2495 (2026-05; still open; MCP still drops out-of-hunk comments on submit). **[UNVERIFIED]** whether GraphQL create succeeds on expanded unchanged lines.

---

### 3. Replies and resolving

**Replies (REST):** `POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies` — body only. `comment_id` **must be a top-level review comment**; “Replies to replies are not supported.” Same page: https://docs.github.com/en/rest/pulls/comments  
Alt: create-comment with `in_reply_to`. GraphQL: `addPullRequestReviewThreadReply`.

**Resolve/unresolve: GraphQL-only.**  
`resolveReviewThread` (`threadId` required; optional Copilot `resolutionReason`)  
`unresolveReviewThread` (`threadId`)  
https://docs.github.com/en/graphql/reference/pulls  
No REST resolve endpoint on https://docs.github.com/en/rest/pulls/comments or `/reviews`.

**List threads + resolved:** GraphQL `pullRequest.reviewThreads { isResolved isOutdated isCollapsed line originalLine path subjectType comments {…} }`. Example still used in 2026: https://github.com/orgs/community/discussions/9175

**REST `resolved`:** **no.** REST review-comment schema has `line`, `original_line`, `commit_id`, `original_commit_id`, `subject_type`, etc. — not `resolved`/`outdated`. Same discussion + https://github.com/github/github-mcp-server/issues/1086. UI resolve: https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/commenting-on-a-pull-request

---

### 4. Later push / outdated / re-anchor

REST response keeps **both** anchors: `commit_id` + `original_commit_id`, `line` + `original_line` (`original_start_line`, `original_position`). Create docs: “Not using the latest commit SHA may render your comment outdated if a subsequent commit **modifies the line**.” https://docs.github.com/en/rest/pulls/comments

GraphQL thread: `isOutdated`, `line`, `originalLine`. Comment: `outdated`, `originalCommit`, `originalLine`. https://docs.github.com/en/graphql/reference/pulls  
UI Conversations menu distinguishes unresolved / resolved / **outdated**: https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/commenting-on-a-pull-request

**Re-anchor: partial, yes; algorithm unpublished.** GitHub keeps `original_*` as the creation site and updates current `line`/`commit_id` when it can still place the comment on HEAD; if the commented line’s content is modified/removed, the thread is **outdated** (`isOutdated`), not deleted. REST has no `outdated` flag — infer from `original_line` vs `line` / GraphQL. Exact matching rules: **[UNVERIFIED / not documented]**. GitHub also says the 2025 “comment anywhere” work “changes the positioning logic for comments in general.”

---

### 5. Reviews

https://docs.github.com/en/rest/pulls/reviews  
`POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews`  
`event`: `APPROVE` | `REQUEST_CHANGES` | `COMMENT`. **Omit `event` → `PENDING`** (no `submitted_at`). Submit later: `POST .../reviews/{review_id}/events`. Delete pending: `DELETE .../reviews/{review_id}` (submitted reviews cannot be deleted).  
`body` required when `event` is `REQUEST_CHANGES` or `COMMENT`. `commit_id` optional (defaults to latest).

**Single-comment review in one call: yes.** `comments[]` with required `path` + `body`; `position` and/or `line`/`side`/`start_line`/`start_side`. Docs example posts `event: REQUEST_CHANGES` with one inline comment.

**Approve own PR:** 422 body `"errors":["Review Can not approve your own pull request"]` (exact, Jan 2026): https://github.com/fleetdm/fleet/issues/38750  
Product: anyone with **read** can review, but authors cannot supply a merge-relevant approval. https://docs.github.com/en/pull-requests/reference/pull-request-reviews

---

### 6. Suggested changes

Syntax is a fenced block in the review-comment `body` (toolbar inserts it): https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/commenting-on-a-pull-request  
https://docs.github.com/en/pull-requests/get-started/reviewing-pull-requests-quickstart  

```suggestion
replacement code
```

Apply is **UI-only** (“Commit suggestion” / batch): https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/incorporating-feedback-in-your-pull-request  
Origin: https://github.blog/changelog/2018-10-16-suggested-changes/  
**No** documented REST/GraphQL “apply suggestion” mutation (not in https://docs.github.com/en/graphql/reference/pulls). Agents apply by committing via Contents/Git Data API. **[UNVERIFIED]** any private web-only apply endpoint.

---

### 7. Permissions

**Web / product:** “Anyone with read access can review and comment.” https://docs.github.com/en/pull-requests/reference/pull-request-reviews  
https://docs.github.com/en/pull-requests/get-started/reviewing-pull-requests-quickstart

**GitHub App:** repository permission **Pull requests: write** for `POST .../pulls/{n}/comments`, replies, and `POST .../reviews`. Table: https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps (section “Repository permissions for Pull requests”; those endpoints list Access=`write`, Additional permissions=`✗`).

**Classic OAuth `public_repo`:** public-only subset of `repo` — “read/write access to code, commit statuses, repository projects, collaborators, and deployment statuses for **public** repositories.” https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps  
No dedicated “review comments” scope. **[INFERENCE]** `public_repo` is enough to post review comments on public repos (same write surface as `repo`, public-only). Unauthenticated / no-scope cannot create comments.

---

### 8. Rate limits (many comments)

https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api  
Create-comment/create-review docs warn: “Creating content too quickly… **secondary rate limiting**.” https://docs.github.com/en/rest/pulls/comments

Relevant secondary caps:
- **Content creation:** “no more than **80** content-generating requests per minute and **500** per hour” (web + REST + GraphQL). Some endpoints lower; subject to change.
- REST: **900 points/minute/endpoint**; most POST = **5 points**.
- ≤100 concurrent (REST+GraphQL).
- Primary: 5,000 req/hour authenticated user (15k GHEC apps).

No way to inspect secondary remaining. 403/429 + backoff.

---

### 9. `gh` / Claude Code / Codex

**`gh pr view --comments`:** prints PR details + **issue comments + reviews**, not GraphQL threads. JSON fields include `comments`, `reviews`, `latestReviews` — **no `reviewThreads` / `isResolved`**. https://cli.github.com/manual/gh_pr_view  
**Easy for agents: `gh api graphql`.** https://cli.github.com/manual/gh_api — documented GraphQL example; community still uses it for `reviewThreads` (discussion #9175). Inline create via REST is the usual `gh api repos/{o}/{r}/pulls/{n}/comments` path (see also https://github.com/cli/cli/issues/13358).

**Claude Code: yes, commonly posts/reads GitHub review comments.** Managed Code Review posts **inline comments** + review body + check run: https://code.claude.com/docs/en/code-review  
Local `/code-review --comment` “posts the findings on a GitHub pull request as **inline comments**”: https://code.claude.com/docs/en/code-review-local  
`@claude review` on the PR: https://code.claude.com/docs/en/code-review-pull-requests

**Codex: yes.** GitHub integration + `@codex review` / automatic cloud reviews: https://learn.chatgpt.com/docs/third-party/github  
https://help.openai.com/en/articles/20001552-review-pull-requests-with-codex  
Codex App has had bugs showing open PR comments: https://github.com/openai/codex/issues/22874

---

### 10. Gether vs Graphite

**Gether (tnkuehne/gether, gether.md): GitHub review comments via REST, not own storage.** README: “Showing and writing comments on pull requests in UI.” https://github.com/tnkuehne/gether  
Code: Octokit `pulls.listReviewComments` / `createReviewComment` / `createReplyForReviewComment`; types include `original_line`, `subject_type`. Local `resolved: false` is hardcoded when grouping — they do **not** call GraphQL resolve. https://raw.githubusercontent.com/tnkuehne/gether/main/packages/ui/src/lib/github-app.ts  
UI: https://raw.githubusercontent.com/tnkuehne/gether/main/packages/ui/src/lib/components/editor/PRCommentThread.svelte

**Graphite: GitHub review comments via GitHub’s model.** “Anything you can do through the GitHub UI, you can do in Graphite.” Comments, approve, request changes, resolve threads: https://graphite.com/docs/review-pull-requests  
Line comments + “Add to review” pending batch + suggested edits: https://graphite.com/docs/pr-page-overview  
GitHub App + webhooks: https://graphite.com/docs/authenticate-with-github-app  
Graphite Agent inline comments are GitHub review comments: https://graphite.com/docs/ai-review-comments  
They may cache for the app; **source of truth is GitHub**, not a parallel comment store. **[INFERENCE]** on cache internals.

---

**Red Letter implication:** defaulting margin comments on an open PR to GitHub review comments matches Gether/Graphite, but you inherit: comments must sit on the **unified diff** (or `subject_type: file`); expanded unchanged lines are UI-only; resolve/outdated need GraphQL; suggestions apply only in GitHub UI; secondary content-creation limits if you fan out many comments.