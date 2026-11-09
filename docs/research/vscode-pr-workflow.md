# 🧭 VS Code GitHub Pull Requests extension: the workflow, precisely

Research for Red Letter's review mode (2026-11-09), from the extension's README, wiki, package.json / package.nls.json and sources. Links per claim; `[UNVERIFIED]` where the agent couldn't confirm.

Sources: [README](https://github.com/microsoft/vscode-pull-request-github/blob/main/README.md), [wiki](https://github.com/microsoft/vscode-pull-request-github/wiki), [package.json 0.176.1](https://github.com/microsoft/vscode-pull-request-github/blob/main/package.json), [package.nls.json](https://github.com/microsoft/vscode-pull-request-github/blob/main/package.nls.json), [VS Code GitHub docs](https://code.visualstudio.com/docs/sourcecontrol/github). Code strings from the same repo’s webviews/tree/review sources.

---

## 1. Pull Requests tree view

Activity Bar container **GitHub** (`view.github.pull.requests.name`); view **Pull Requests** (`pr:github`).  
https://github.com/microsoft/vscode-pull-request-github/blob/main/package.nls.json  
https://github.com/microsoft/vscode-pull-request-github/blob/main/package.json

### Default query categories (current `package.json` default, in order)

Setting `githubPullRequests.queries` ([package.json](https://github.com/microsoft/vscode-pull-request-github/blob/main/package.json)):

| Order | Label | Query / meaning |
|---|---|---|
| 1 | **Copilot on My Behalf** | `repo:${owner}/${repository} is:open author:copilot assignee:${user}` — PRs you asked Copilot to create. Tooltip: “Pull requests you asked the coding agent to create” ([categoryNode.ts](https://github.com/microsoft/vscode-pull-request-github/blob/main/src/view/treeNodes/categoryNode.ts)) |
| 2 | **Local Pull Request Branches** | `"query": "default"` — PRs for branches you have locally. Tooltip: “Pull requests for branches you have locally” |
| 3 | **Waiting For My Review** | `repo:${owner}/${repository} is:open review-requested:${user}` |
| 4 | **Created By Me** | `repo:${owner}/${repository} is:open author:${user}` |
| 5 | **All Open** | `"query": "default"` — all open PRs in the current repo. Tooltip: “All open pull requests in the current repository”. Expanded by default if no expansion state. |

README is **stale**: it still lists “Waiting For My Review”, “Assigned To Me”, “Created By Me” only ([README](https://github.com/microsoft/vscode-pull-request-github/blob/main/README.md)). **Assigned To Me** (`is:open assignee:${user}`) is *not* in the current default array; nls markdown still names it among defaults ([package.nls.json](https://github.com/microsoft/vscode-pull-request-github/blob/main/package.nls.json)).

Empty category: **0 pull requests in this category**. Pagination: **Load more**. ([categoryNode.ts](https://github.com/microsoft/vscode-pull-request-github/blob/main/src/view/treeNodes/categoryNode.ts))

### PR node (not expanded)

- Label: PR title (draft italicized unless avatar mode is `state`); optional `#N: ` if `githubPullRequests.showPullRequestNumberInTree`; `$(check)` prefix if this PR is checked out. ([pullRequestNode.ts](https://github.com/microsoft/vscode-pull-request-github/blob/main/src/view/treeNodes/pullRequestNode.ts))
- Description: `by @login`
- Click: **View Pull Request Description** → `pr.openDescription` (opens overview webview). **There is no Description child node** — removed in [#6769](https://github.com/microsoft/vscode-pull-request-github/commit/20a06d8041eb30d5a0b733c78afa4869ddb590e3).

### What a PR node expands into

Children = changed files only ([pullRequestNode.ts](https://github.com/microsoft/vscode-pull-request-github/blob/main/src/view/treeNodes/pullRequestNode.ts)):

- `githubPullRequests.fileListLayout` default **`tree`** → directory tree (compact: empty root pulled up). Command **View as Tree** / **View as List**.
- `flat` → file list. Command **View as List**.

Per-file **viewed** checkbox ([fileChangeNode.ts](https://github.com/microsoft/vscode-pull-request-github/blob/main/src/view/treeNodes/fileChangeNode.ts)):

- Unchecked tooltip **Mark File as Viewed**
- Checked tooltip **Mark File as Unviewed**
- Hidden for older-commit file nodes. Commands: **Mark File As Viewed** / **Mark File As Not Viewed**. Setting `githubPullRequests.hideViewedFiles`.

### Clicking a file

Opens VS Code diff (`vscode.diff`). Title format: **`{basename} (Pull Request)`** ([fileChangeNode.ts](https://github.com/microsoft/vscode-pull-request-github/blob/main/src/view/treeNodes/fileChangeNode.ts)).  
Added files open the file (not a diff). Remote-only files: **Open File on GitHub**.

### Context menu on a PR node (`view/item/context`)

From [package.json](https://github.com/microsoft/vscode-pull-request-github/blob/main/package.json) + [package.nls.json](https://github.com/microsoft/vscode-pull-request-github/blob/main/package.nls.json):

- **Add to Stack** (`pr.addToStack`) — if `:stackable` and `github:canAddToStack`
- **Checkout Pull Request** (`pr.pick`) — non-active
- **Checkout Default Branch** (`pr.exit`) — active (checked out)
- **Checkout Pull Request on vscode.dev**
- **Checkout Pull Request on Codespaces**
- **Checkout Pull Request in Worktree** (`pr.pickInWorktree` — desktop)
- **Open Changes**
- **Open Pull Request Description to the Side**
- **Open Pull Request on GitHub**
- **Refresh Pull Request**
- **Delete Local Branch** — local + non-active
- **Dismiss Notification** — if `:notification`
- **Summarize With Copilot** — if Copilot chat + `githubPullRequests.experimental.chat`

Inline on the row: **Checkout Pull Request**, **Open Changes**, **Show Changes Since Last Review** / **Show All Changes**.

**Copy Link is not on the PR tree context menu.** Command **Copy Link** (`pr.copyPrLink`) is on the description webview (header button + webview context). Command palette **Copy Pull Request Link** (`review.copyPrLink`) when in review mode.

---

## 2. Checkout / review mode

Docs: https://code.visualstudio.com/docs/sourcecontrol/github#_reviewing  
Code: [reviewManager.ts](https://github.com/microsoft/vscode-pull-request-github/blob/main/src/view/reviewManager.ts)

### **Checkout Pull Request** (`pr.pick`)

Checks out the PR branch (`checkoutExistingPullRequestBranch` or `fetchAndCheckout`), then enters review mode. Optional pre-checkout pull/merge via `githubPullRequests.pullPullRequestBranchBeforeCheckout` (default `pull`).

Status bar while switching:

1. `$(sync~spin) Switching to Review Mode`
2. `$(sync~spin) Fetching additional data: pr/{N}`
3. Then **`$(git-pull-request) Pull Request #{N}`** (click → **View Pull Request Description**)

### Review-mode UI

Container **GitHub Pull Request**. Views:

- **Changes in Pull Request #{N}** (tree `prStatus:github`; nls default title **Changes In Pull Request**; runtime `Changes in Pull Request #{0}`). One PR → `#{N}`; multi-repo → **Changes in Pull Requests**. ([prChangesTreeDataProvider.ts](https://github.com/microsoft/vscode-pull-request-github/blob/main/src/view/prChangesTreeDataProvider.ts))
- Root child = PR title (click → description). Children:
  - **Files** (expanded) — tree/list of diffs + viewed checkboxes
  - **Commits** (collapsed)
- **Review Pull Request** webview (`github:activePullRequest`) when focused review and one active PR
- Multi-diff editor tab label starts with **Changes in Pull Request #{N}**

Toolbar on Changes view: **View as Tree** / **View as List**, **Toggle Hide Viewed Files**, commenting on/off, **Refresh**.

Focused layout (`githubPullRequests.focusedMode`, default `multiDiff`): first diff / overview / all diffs.

### Leaving review mode

- Docs still say **Exit Review Mode** ([github.md](https://code.visualstudio.com/docs/sourcecontrol/github.md)).
- Current command title: **Checkout Default Branch** (`pr.exit`). Changelog 0.164.0 renamed Exit Review Mode → Checkout default Branch.
- Description webview when checked out: primary button **`Checkout '{doneCheckoutBranch}'`** (default branch name), plus **Open Changes**. ([header.tsx](https://github.com/microsoft/vscode-pull-request-github/blob/main/webviews/components/header.tsx))
- `githubPullRequests.postDone` default: checkout default branch (optional pull / PR base branch).

### Uncommitted changes

Docs: commit or **stash** first, then Checkout. After review: “Preserve any local edits before switching.”  
If git refuses: **Your local changes would be overwritten by checkout, please commit your changes or stash them before you switch branches** (`LocalChangesOverwritten` / `DirtyWorkTree`). ([reviewManager.ts](https://github.com/microsoft/vscode-pull-request-github/blob/main/src/view/reviewManager.ts))

Unsaved comment drafts can keep review mode from clearing.

---

## 3. PR Description (overview) webview

Layout: [overview.tsx](https://github.com/microsoft/vscode-pull-request-github/blob/main/webviews/editorWebview/overview.tsx), [header.tsx](https://github.com/microsoft/vscode-pull-request-github/blob/main/webviews/components/header.tsx), [sidebar.tsx](https://github.com/microsoft/vscode-pull-request-github/blob/main/webviews/components/sidebar.tsx), [merge.tsx](https://github.com/microsoft/vscode-pull-request-github/blob/main/webviews/components/merge.tsx), [comment.tsx](https://github.com/microsoft/vscode-pull-request-github/blob/main/webviews/components/comment.tsx)

Wide layout: main column then right sidebar. Narrow (≤768px): collapsible sidebar first.

### Header (in order)

1. **Title** as `h2` + clickable **`#{number}`** (opens GitHub)
2. Pencil **Rename** (if `canEdit`) → form **Cancel** / **Update**
3. **Copy Link**
4. **View Changes** (not issues)
5. Status badge: **Open** | **Draft** | **Merged** | **Closed**
6. Optional stack badge
7. Author avatar + **`{author} wants to merge changes into {base} from {head}`** (merged: **merged changes**). Base is a **Change base branch** button if open + canEdit.
8. Actions: **Checkout** (or **`Checkout '{branch}'`** if already checked out) + dropdown **Open Changes**, **Checkout in Worktree**, **Checkout on vscode.dev**, **Checkout on Codespaces**; then **Refresh**
9. Coding-agent: **Cancel Coding Agent** / **View Session** when Copilot session is running

### Sidebar (order)

**Reviewers** → **Assignees** → **Labels** → **Project** (not Enterprise) → **Milestone** → linked closing issues if any.

Empty: **None yet**; milestone **No milestone**. Assignees empty + write: **assign yourself**. Copilot icons: **Request review from Copilot**, **Assign for Copilot to work on**. Convert-to-draft under reviewers when not draft.

### Main column (order)

1. Description body (`CommentView isPRDescription`). Empty: *No description provided.* Sparkle generate + **Upload files** when editing. **Save** / **Cancel**.
2. **Timeline** of commits, reviews, comments, merge/close/reopen, labels, assignees, review requests, draft/ready, force-push, restore, auto-merge, merge-queue, Copilot sessions, etc. ([timeline.tsx](https://github.com/microsoft/vscode-pull-request-github/blob/main/webviews/components/timeline.tsx))
3. **Status checks** — summary like `N successful checks and M failed checks`; expand **Show status checks**; per-check **Required**, **Details**, **View Logs**
4. Required-reviewer summary if present
5. Stack section (if stacked)
6. Mergeability: e.g. **This branch has no conflicts with the base branch.** / **This branch has conflicts that must be resolved.** / **This branch is out-of-date with the base branch.** Actions **Resolve conflicts**, **Update with merge commit**
7. Merge (write + mergeable, not draft, not queued):
   - Button **Merge Pull Request** `using method` `<select>`: **Create Merge Commit** | **Squash and Merge** | **Rebase and Merge** (`(not enabled)` if repo disables)
   - Confirm: title/body, **Commit will be associated with {email}**, **Cancel**, then **Create Merge Commit** / **Squash and Merge** / **Confirm Rebase and Merge**
   - Merge queue: **Add to Merge Queue**
   - Else **Auto-merge** / **Merge when ready** checkbox + method dropdown
8. Draft: **This pull request is still a work in progress.** / **Draft pull requests cannot be merged.** Button **Ready for Review** (Copilot-on-behalf also **Ready, Approve, and Auto-Merge**)
9. After merge/close: **Pull request successfully merged.** / **This pull request is closed.** Then **Delete Branch...** (not a merge-time checkbox)
10. Comment box (below)

### Comment box (overview)

- Placeholder **Leave a comment**; **Upload files**
- Left: **Close Pull Request** (write or author; disabled if not Open)
- Optional **Add attestation**
- Right dropdown title **Submit pull request review**: **Comment** | **Approve** | **Request Changes** (author: **Comment** only; SAML: **Approve on github.com** / **Request changes on github.com**)
- Approve allowed with empty body; Comment/Request Changes need text or a pending review (`hasReviewDraft`)
- Ctrl/Cmd+Enter submits current selection

**Reopen:** no **Reopen Pull Request** button in this webview (Close is disabled when not Open). Timeline can show a reopened event. **Unverified** as a user-facing control.

**Delete branch after merge:** not a merge checkbox. Setting `githubPullRequests.deleteBranchAfterMerge` (default false) auto-deletes after merge *through this extension*. After merge, **Delete Branch...**.

Editor title on this panel: **Open Pull Request on GitHub**.

---

## 4. Commenting (diff / Comments panel)

Commands from [package.nls.json](https://github.com/microsoft/vscode-pull-request-github/blob/main/package.nls.json); menus from [package.json](https://github.com/microsoft/vscode-pull-request-github/blob/main/package.json) `comments/commentThread/context`.

Default `githubPullRequests.defaultCommentType` = **`review`**.

| State | Buttons |
|---|---|
| No pending review, default `review` | Primary **Start Review** (`pr.startReview`); secondary **Add Comment** (`pr.createSingleComment`) |
| No pending review, default `single` | Primary **Add Comment**; secondary **Start Review** |
| Pending review (`reviewInDraftMode` / `prInDraft`) | **Add Review Comment** (`pr.createComment`) — *not* the github.com string “Add Comment to Review” |
| Also | **Comment and Resolve** if thread `canResolve`; **Make Code Suggestion**; **Upload File** |

- **Add Comment**: posts immediately.
- **Start Review**: starts a pending review; comments stay draft until submitted from Description.
- **Add Review Comment**: adds to the pending review.

Pending look: comment **label `Pending`**; VS Code `CommentState.Draft`. ([prComment.ts](https://github.com/microsoft/vscode-pull-request-github/blob/main/src/github/prComment.ts)) Overview timeline: `<em>pending</em>` + `Pending`.

**Finish / submit:** there are **no** commands titled **Finish Review** or **Submit Review**. With a draft: **Go to Review** (`pr.openReview`) jumps to Description pending-review section. Submit there via **Comment** / **Approve** / **Request Changes**. Dropdown aria **Submit pull request review**.

Threads:

- **Resolve Conversation** / **Unresolve Conversation**
- **Comment and Resolve**
- Thread labels: **Start discussion** | **Participants: @a, @b** | **Marked as resolved** ([utils.ts](https://github.com/microsoft/vscode-pull-request-github/blob/main/src/github/utils.ts))

Suggestions:

- **Make Code Suggestion** (`pr.makeSuggestion`) — *not* “Make a Suggestion”
- **Convert to Pull Request Suggestion** / **Create Pull Request Suggestions** (from local/SCM diffs)
- **Apply Suggestion** / **Apply Suggestion Using AI**
- Overview body with ````diff` + checked out: **Apply Patch**

Reactions: GitHub reaction groups on comment threads (`reactionHandler`); overview shows counts/tooltips (`{names} reacted with {label}`). Exact emoji set: **unverified** here (code maps `getReactionGroup()`).

Also: **Add File Comment**, **Quote reply**, **Copy Comment Link**, **Edit Comment**, **Delete Comment**, **Diff Comment with HEAD** (outdated).

---

## 5. Notifications / other views / Create PR

### Issues (`issues:github`)

Default queries ([package.json](https://github.com/microsoft/vscode-pull-request-github/blob/main/package.json)): **My Issues**, **Created Issues**, **Recent Issues**. First query expanded.  
Docs: https://code.visualstudio.com/docs/sourcecontrol/github#_issues  
Context: **Start Working on Issue** (creates branch; Status Bar shows active issue). **+** / **GitHub Issues: Create an Issue**. TODO code action. Commands: **Create Issue From Selection**, **Create Issue From Clipboard**.

### Notifications (`notifications:github`)

Contributed, default **collapsed**. Not shown in browser Codespaces. Commands: **Refresh**, **Load More Notifications**, **Sort by Timestamp**, **Sort by Priority using Copilot**, **Open on GitHub**, **Mark as Read**, **Mark as Done**, **Summarize With Copilot**. Setting `githubPullRequests.notifications`: `pullRequests` | `off` (default off).

### Copilot

- Query **Copilot on My Behalf**
- **Summarize With Copilot**, **Suggest a Fix with Copilot**, **Assign to Coding Agent**
- Create-PR sparkle: **Generate Pull Request Title and Description**
- Docs **Code Review** in Create view ([github.md](https://code.visualstudio.com/docs/sourcecontrol/github.md))
- Chat participant `@githubpr` if `githubPullRequests.experimental.chat` (default true)
- Coding agent settings under `githubPullRequests.codingAgent.*`

### Create Pull Request

Command **GitHub Pull Requests: Create Pull Request** (`pr.create`). View **Create** + **Files Changed** + **Commits**.  
Webview: [app.tsx](https://github.com/microsoft/vscode-pull-request-github/blob/main/webviews/createPullRequestViewNew/app.tsx)

- **Base** / **Merge** branch pickers
- **Title** (required; **A title is required**); sparkle generate
- Action bar: **Add Assignees**, **Add Reviewers**, **Apply Labels**, **Set Milestone**, **Set Projects**
- **Description** (template via `githubPullRequests.pullRequestDescription` default `template`; else latest commit / none / Copilot)
- Optional stack checkbox
- **Cancel**
- Create dropdown: **Create** | **Create Draft** | **Create + Auto-Merge** | **Create + Auto-Squash** | **Create + Auto-Rebase** | **Create + Merge When Ready**  
  Docs also say **Create Draft** from the Create menu and **Auto-Merge** depending on repo/permissions.

Unpublished branch: prompt to pick a remote (e.g. fork). `githubPullRequests.postCreate` default **openOverview** → Review Mode.

---

## 6. Commands / shortcuts

**No `keybindings` contribution** in [package.json](https://github.com/microsoft/vscode-pull-request-github/blob/main/package.json). Accessibility help lists commands that *can* have user keybindings: Refresh Pull Requests List, Focus on Issues/Pull Requests View, Create Pull Request, Copy GitHub Permalink, Create an Issue.

Category **GitHub Pull Requests** unless noted.

| Command title | ID |
|---|---|
| Create Pull Request | `pr.create` |
| Checkout Pull Request | `pr.pick` |
| Checkout Pull Request by Number | `pr.checkoutByNumber` |
| Checkout Default Branch | `pr.exit` |
| Checkout Pull Request on vscode.dev / Codespaces / in Worktree | `pr.pickOnVscodeDev` / `pr.pickOnCodespaces` / `pr.pickInWorktree` |
| Open Changes | `pr.openChanges` |
| View Pull Request Description | `pr.openDescription` |
| Open Pull Request on GitHub | `pr.openPullRequestOnGitHub` |
| Merge Pull Request | `pr.merge` |
| Ready for Review | `pr.readyForReview` |
| Copy Link | `pr.copyPrLink` |
| Copy Pull Request Link | `review.copyPrLink` |
| Add Comment | `pr.createSingleComment` |
| Start Review | `pr.startReview` |
| Add Review Comment | `pr.createComment` |
| Make Code Suggestion | `pr.makeSuggestion` |
| Apply Suggestion | `pr.applySuggestion` |
| Approve / Comment / Request Changes | `review.approve` / `review.comment` / `review.requestChanges` |
| Go to Review | `pr.openReview` |
| Resolve Conversation / Unresolve Conversation | `pr.resolveReviewThread` / `pr.unresolveReviewThread` |
| Go to Next/Previous Diff in Pull Request | `pr.goToNextDiffInPr` / `pr.goToPreviousDiffInPr` |
| Refresh Pull Requests List | `pr.refreshList` |
| Sign in to GitHub | `pr.signin` |
| Select GitHub Enterprise Account... | `pr.selectEnterpriseAccount` |

**GitHub Issues:** Create an Issue, Start Working on Issue, Stop Working on Issue, Create Issue From Selection/Clipboard.  
**GitHub Notifications:** Refresh, Mark as Read/Done, etc.

---

### Doc vs code mismatches (for mimicry)

- README default queries ≠ `package.json` (no **Assigned To Me**; extra **Copilot on My Behalf**, **Local Pull Request Branches**, **All Open**).
- Docs **Exit Review Mode** vs UI **Checkout Default Branch** / **Checkout '{branch}'**.
- GitHub.com **Add Comment to Review** / **Finish Review** / **Make a Suggestion** vs VS Code **Add Review Comment** / **Go to Review** + Description submit / **Make Code Suggestion**.
…
- **Copy Link** is on the overview, not the PR tree context menu.

[Showing lines 1-300 of 302. Use :301 to continue]