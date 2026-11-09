# 🧾 Comments vs changes: how products model document review

Research for Red Letter's review flow (2026-11-09): is a comments-only review the same object as a change review? Links per claim; `[INFERENCE]` marked.

**Two objects, not one.** Live-doc comments (threads, resolve) and proposed changes (branch/suggestion/PR, accept/merge) are separate in almost every product. GitHub PRs cannot be comments-on-current-text; that is Issues/Discussions. Fake-newline PRs are a GitHub API constraint, not a product model.

---

### Google Docs
**Unit:** both, on the live doc. Comments = discussion; Suggesting = proposed edits (not a named review/PR).  
**Comments-only:** threads only (listable in Comments panel / Drive Activity), not a named “review.” Open → **Resolve** (reopen).  
**Changes end:** Accept / Reject (or Accept all / Reject all under Tools → Review suggested edits). Version history is audit, not a review object.  
**UI:** both in right margin; suggestions look like comments with Accept/Reject. No `+N −M` list.  
Sources: [Suggest edits](https://support.google.com/docs/answer/6033474), [Comments](https://support.google.com/docs/answer/65129)

### Microsoft Word
**Unit:** both. Comments vs Track Changes (Web: Reviewing mode).  
**Comments-only:** threads (Comments pane). Resolve / delete; resolved stay in pane until deleted. Not a named review.  
**Changes end:** Accept / Reject (Review tab). Accept All does **not** resolve comments. Reviewing Pane lists **both** types together.  
**UI:** balloons + Comments pane vs markup in text + Reviewing Pane. No `+N −M`.  
Sources: [Give and receive feedback](https://support.microsoft.com/en-us/word/give-and-receive-feedback-in-word), [Track changes](https://support.microsoft.com/en-us/word/training/track-changes-in-word)

### Figma
**Unit:** both, and they don’t mix. File comments vs branches + **Request review**. Branch comments **do not** copy to main on merge.  
**Comments-only:** pins/threads on the live file (Comment mode, sidebar). Resolve hides pin. Not a named review.  
**Changes end:** Approve / Request changes on the **branch**, then **Merge branch** (archived/locked). Review is optional for merge. Status badges: In review / Changes suggested / Approved.  
**UI:** comments = canvas pins + right sidebar. Changes = Branch review modal, listed by page; not `+N −M` lines.  
Sources: [Comments](https://help.figma.com/hc/en-us/articles/360041547593-View-and-manage-comments), [Request a branch review](https://help.figma.com/hc/en-us/articles/5691414603543-Request-a-branch-review), [Guide to branching](https://help.figma.com/hc/en-us/articles/360063144053-Guide-to-branching)  
X: [@figma branching](https://x.com/figma/status/1447964299570393088), [review states](https://x.com/figma/status/1524052614094106629)

### GitBook
**Unit:** both. Live **Comments** (page/block, Resolve) vs **Change requests** (branch-like, listable, Request review → Merge). Comments also live *inside* CRs.  
**Comments-only:** first-class **threads**, not a CR. CR is the named review object. [INFERENCE] empty CR is creatable (Edit opens a CR before you type); docs never pitch comment-only CRs. Merge of empty CR would be a no-op publish. Archive, don’t delete.  
**Changes end:** Merge (live immediately; irreversible except new CR). Reviewers: approve / comment / request more edits. Merge rules can require reviews.  
**UI:** comments panel vs CR **Changes** tab (split/inline diff, changed-page indicators). CR list is the change list, not `+N −M`.  
Sources: [Change requests](https://gitbook.com/docs/collaborate/change-requests), [Comments](https://gitbook.com/docs/collaborate/comments), [CRs in a section](https://gitbook.com/docs/collaborate/change-requests/change-requests-in-a-space)

### Notion
**Unit:** both on the live page. Page/block comments vs **Suggest edits** (2024–25). No PR/branch.  
**Comments-only:** threads (Comments pane). Resolve checkmark; reopen from Updates. Not a named review.  
**Changes end:** Accept ✔️ / Reject ❌ per suggestion (side of page). Can comment *on* a suggestion.  
**UI:** comments = icons / right panel; suggestions = inline markup + side cards. No `+N −M`.  
Sources: [Suggested edits](https://www.notion.com/help/suggested-edits), [Comments](https://www.notion.com/help/comments-mentions-and-reminders)  
X: [@NotionHQ suggest edits](https://x.com/NotionHQ/status/1807819016729460894)

### Confluence
**Unit:** comments on live/draft pages; **page drafts / Update / Publish** for changes. **No native Suggest changes** (community asks for Google-Docs-style; apps like Talk fill it). Live docs have no drafts.  
**Comments-only:** inline + general threads. Resolve / Reopen. Not a named review. Draft comments stay editor-only until publish.  
**Changes end:** Publish / Update (version history). Comments: Resolve.  
**UI:** yellow highlight + comments panel vs editor draft. No `+N −M`.  
Sources: [Comments](https://support.atlassian.com/confluence-cloud/docs/comment-on-pages-and-blog-posts/), [Create/publish](https://support.atlassian.com/confluence-cloud/docs/create-edit-and-publish-a-page/), [Suggest-changes request](https://community.atlassian.com/forums/discussion/679988/suggest-changes-like-in-google-docs)

### GitHub / Graphite
**Unit:** **change set only** (PR). Review comments attach to the **diff**, not the live file. Issues / Discussions = comment-only objects.  
**Comments-only “review” as a PR:** **not first-class.** Identical branches → *“There isn’t anything to compare.”* Empty-commit / whitespace PR is a hack. Review comments historically only on changed lines (+ ~3 context); Graphite claims comments **anywhere**. GitHub *review* types: **Comment / Approve / Request changes** — these are verdicts **on a PR that already has a diff**.  
**Changes end:** Merge (or close). Threads: **Resolve conversation**. A Comment-type review does not merge and does not close.  
**UI:** Conversation vs Files changed (`+N −M` per file). Empty PR shows 0 files / 0 lines.  
Sources: [Communicating on GitHub](https://docs.github.com/en/get-started/using-github/communicating-on-github), [Reviewing proposed changes](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-proposed-changes-in-a-pull-request), [Graphite review](https://graphite.com/docs/review-pull-requests)  
X: [GitHub review comments](https://x.com/github/status/1648081424698753031)

### Ink & Switch Upwelling / Patchwork
**Unit:** **draft/layer/branch** is the review unit (titled, shareable, mergeable). Comments attach to drafts *and* (Patchwork) via universal pointers on any doc. Edit Groups experiment: comments/rationale **without** branches.  
**Comments-only:** threads on the live/draft text; **not** a named review. Review **of a branch/draft** is first-class (dropdown shows name, author, **change count** ≈ `+N −M`).  
**Changes end:** **Merge draft onto stack** (then immutable) or delete draft. Comments: discussion, not accept. No enforced approve gate (social convention).  
**UI:** Show Changes in text; stack dropdown; comments on spans. Branch picker (Patchwork 06).  
Sources: [Upwelling](https://www.inkandswitch.com/upwelling/), [Simple branching](https://www.inkandswitch.com/patchwork/notebook/2024-version-control/06/), [Universal comments](https://www.inkandswitch.com/patchwork/notebook/2024-version-control/11/)

### Dropbox Paper
**Unit:** both on the live doc. Comments vs **Suggest edits**. No named review.  
**Comments-only:** threads; **Resolve** / Unresolve in Comment history.  
**Changes end:** Accept / Reject suggestion. Doc history for versions.  
**UI:** right-margin comments; suggestion = strike + replacement in-thread. No `+N −M`.  
Source: [Collaborate on Paper](https://help.dropbox.com/view-edit/doc-collaboration)

### Coda
**Unit:** both. Comments vs **Suggest changes**. No PR.  
**Comments-only:** threads (resolve). Not a named review.  
**Changes end:** Accept / Reject (green/red highlights, right-edge bubbles).  
**UI:** comments rail vs inline suggestion markup. No `+N −M`.  
Source: [Suggest changes](https://help.coda.io/hc/en-us/articles/39555896123789-Boost-collaboration-with-suggest-changes) (403 here; title/flow from that help article)

### Craft
**Unit:** **comments only** (per block) + version history. No Suggest/Track Changes. “Document Review” is **AI**, not a human review object.  
**Comments-only:** threads on blocks. [INFERENCE] no Resolve in help; notify/reply. Not a named review.  
**Changes end:** nothing to accept; edit live or restore history.  
**UI:** block comments. No change list.  
Sources: [Comments](https://support.craft.do/en/introduction/navigation/comments), [Share](https://support.craft.do/en/share-and-publish/share)

### HackMD
**Unit:** live-note **comments** (select text, right panel) vs **GitHub Sync** (push/pull versions/commits). Comments **do not** sync to GitHub.  
**Comments-only:** threads on the note; toggle visibility; convert comment → new note. No named review. Resolve not documented.  
**Changes end:** GitHub commit/PR outside HackMD. Comments just sit.  
**UI:** highlight + comment panel. GitHub side shows `+N −M` if you open a PR.  
Sources: [Comments](https://hackmd.io/how-to-use-comments), [GitHub sync](https://hackmd.io/link-with-github), [comments not in GitHub sync](https://github.com/hackmdio/hackmd-io-issues/issues/428)

### Gether
**Unit:** **GitHub PR** (branches, open PRs). Editor is live collab **on a git file**; review comments are **PR comments in the UI** (`PRCommentThread`).  
**Comments-only:** not a separate object — if there’s no PR, no review comments. Same GitHub constraint.  
**Changes end:** GitHub merge. Threads: GitHub resolve.  
**UI:** editor + PR comment widgets; GitHub `+N −M` on the PR.  
Sources: [gether.md](https://gether.md/), [README](https://github.com/tnkuehne/gether/)

### Linear / Jira (and GitHub Issues / Discussions)
A comment-only review is an **issue/discussion**, not a PR.

| Object | What it is | Ends |
|---|---|---|
| **GitHub Issue** | named, listable work/discussion on current repo/docs | Close |
| **GitHub Discussion** | forum; often no owner, no patch | Close / answer |
| **Linear Issue** | work item; comments on the issue | status / done |
| **Linear Reviews / Diffs** | **GitHub PRs** mirrored; Comment / Approve / Request changes / Merge | GitHub merge |
| **Jira Issue** | work item; comments on the ticket. PRs live in Bitbucket/GitHub Development panel | Done / Close |

Linear docs treat **issue** and **PR review** as linked but distinct. Jira does not host the review; it links to the PR.  
Sources: [GitHub communicating](https://docs.github.com/en/get-started/using-github/communicating-on-github), [Linear Reviews](https://linear.app/docs/diffs)

---

### Synthesis (markdown-in-git)

1. **Two lifecycles.** Comments-on-current-text: thread, **Resolve/Close**, no patch. Proposed changes: named change-set, **Accept/Merge/Publish**, shows `+N −M` or a diff. Products that do both (Docs, Word, Notion, Paper, Coda, Figma, GitBook, Upwelling) keep them as **different objects**.
2. **A comments-only “review” is never a PR.** GitHub/Graphite/Gether/Linear Reviews require a diff. Empty-PR hacks exist because the API refuses identical branches. The real comment-only objects are **Issues, Discussions, or live-doc threads**.
3. **Where they live.** Comments: margin pins / right panel on the **current** text. Changes: Suggesting markup **or** a separate branch/CR/PR page with a change list. Figma/GitBook/GitHub: comments on a branch stay with the branch.
4. **Don’t fake a PR for comments.** That’s GitHub’s limitation, not the product pattern. Closest honest GitHub mapping: **Issue** (or Discussion) for comments-only; **PR** only when there is a real patch.
5. **Cleanest model for Red Letter:** keep **two types**. (a) **Doc comments** — first-class threads on HEAD, Resolve, listable, no git object. (b) **Change request / PR** — only when there is a real diff; merge ends it; comments on the *diff* die or resolve with the PR. If you need a named comments-only pass, make it an **Issue-like Review** (open → resolved), not a whitespace PR. Optional later: Docs-style Suggesting as a third, *per-span* accept/reject — still not a PR.