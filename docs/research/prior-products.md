# Web editing + comments over git — product survey

**Scope:** products that put a browser editor (and often comments) on files that also live in git. Observed from primary docs/repos unless marked `[INFERENCE]`.

## Product matrix

| Product | Git as truth? | Realtime? | Comments anchored to text? | Commit attribution | Draft model |
|---|---|---|---|---|---|
| **GitBook Git Sync** | Bidirectional MD ↔ GitHub/GitLab. Visual editor is canonical in-app; export may *create new files* rather than overwrite existing MD. CRs ≠ GitHub PRs. | Yes, inside a change request | Yes, inline on CRs via GitBook API — **not in git / not GitHub review comments** | `gitbook-com` GitHub App pushes; message `GITBOOK-{n}: {subject}` | Change requests (in-app branches). Merge → one git commit |
| **HackMD GitHub sync** | Optional push/pull of named versions → commits. Note in HackMD DB is live truth | Yes (OT-style collab) | Yes, select-text comments. **Dropped on GitHub sync** | Push as GitHub App; version name/desc = commit msg. Free = 20 push/pulls/mo | Named versions; can create branch/file on first link |
| **HedgeDoc / CodiMD** | No. Postgres. GitHub = OAuth + gist export. CLI import/export only | Yes | Limited vs HackMD | n/a | Notes, not branches |
| **Outline** | No native git. Community sync is lossy (rich doc ↔ MD) | Yes (Yjs + Hocuspocus) | Yes, inline `anchorText` marks in Yjs/PM | n/a | Docs in DB |
| **Docmost** | No. Third-party CLI/MCP only | Yes (Yjs + Hocuspocus) | Page comments | n/a | Spaces/pages |
| **Decap CMS** | Yes. GitHub Contents API | No. Last-write / non-ff errors | No. Editorial status via PR labels/comments (Bitbucket uses PR comments as *workflow state*) | Logged-in GitHub user (Open Authoring = fork) | `publish_mode: editorial_workflow` → branch `cms/{collection}/{slug}` + PR; optional `squash_merges` |
| **TinaCMS** | Yes | No | No (use GitHub PR) | Default `tina-cloud-app`; optional **Act as You** or `Co-authored-by` | Paid Editorial Workflow: protected branch → new branch + draft PR |
| **Prose.io** | Yes (GitHub API) | No | No | GitHub user | Commit to branch. Project seeking maintainers (`prose/prose#743`) |
| **StackEdit** | Optional GitHub/GDrive/Dropbox sync | Shared workspace merge, not CRDT-over-git | In-app, not git | OAuth user on sync | Local workspace + provider |
| **GitHub blob editor** | Yes | No | No (PR review comments are separate) | Signed-in user email | Commit to current or new branch + PR |
| **github.dev / vscode.dev** | Yes (GitHub Repositories ext; work in browser storage until commit) | No native. Optional Live Share | PR comments via GH extension, not CRDT positions | User | Branch / PR |
| **CodeSandbox Repos** | Yes. Shared VM per branch | Yes (shared FS/VM, not CRDT). **Repo imports ended 2026-04-01; support ends 2026-07-01** | GitHub PR comments | User git identity | Branch + PR |
| **StackBlitz / Codeflow** | Yes (WebContainers git). Web Publisher auto-forks + PR (`pr.new`) | Live preview / advertised collab; not a docs CRDT | PR review | User | Fork/PR |
| **Gitpod (Classic)** | Yes | Shared running workspace (same FS, owner identity) or snapshot clone | PR comments | Workspace owner | Branch |
| **Obsidian Git** (`vinzent03/obsidian-git`) | Local git auto-commit/push | No | No | Local git user | Vault = working tree |
| **Notion → GitHub plugins** | Publish/export only | Notion realtime, not git | Notion comments stay in Notion | Bot/PAT | n/a |
| **Fossil wiki** | Fossil repo (not git). Wiki artifacts auto-merge on sync | No CRDT | Forum/tickets are *separate artifacts*, not text-anchored on wiki | Fossil user | Check-ins / wiki pages |
| **Graft** (`tkjaer/graft`) | GitHub files stay MD. Yjs optional | Optional y-websocket | Yes, range + ~50 char context. JSON on orphan branch `graft-comments` | GitHub user / app | Default branch read-only; create feature branch |
| **MDArena** (`AliOsm/MDArena`) | Bare git per project; Yjs in cache flushed after 60s idle (`FlushYdocToGitJob`). Polls HEAD every 10s then **reload** | Yes (Yjs + CodeMirror 6 + Action Cable) | Roadmap only | App user → git commit | Project repos, not GH PRs |

**Dolt / Irmin / Noms:** red herring for live *text*. Dolt = git-semantics **SQL** (prolly trees). Noms unmaintained (Dolt lineage). Irmin (`irmin-git` 3.11.0) is a mergeable KV with git-on-disk; `omditor` uses it for offline MD sync, not character CRDT + GitHub webhooks. Use Yjs/`Y.Text` (or Automerge) for the live copy; git for snapshots.

## Top 5 recurring complaints

1. **Comments never leave the SaaS.** HackMD GitHub sync pushes MD only; comments/reactions have no API/CLI/export ([hackmdio/hackmd-io-issues#428](https://github.com/hackmdio/hackmd-io-issues/issues/428)). GitBook CR comments are a separate API, not git. X: little public venting; pain is in GitHub issues.
2. **Two review systems that do not map.** GitBook: “Creating a pull request … doesn't create a change request … and vice versa” ([troubleshooting](https://gitbook.com/docs/docs-as-code/git-sync/troubleshooting)). Community: [Git Sync discussions](https://github.com/GitbookIO/community/discussions/categories/3-git-sync) (“Github PRs vs PR from Gitbook app”).
3. **Git-CMS = last-write-wins.** Decap concurrent edit still open since 2017 ([#277](https://github.com/decaporg/decap-cms/issues/277), [#1500](https://github.com/decaporg/decap-cms/issues/1500)). One PR per entry ([#1025](https://github.com/decaporg/decap-cms/issues/1025)). Tina: bot author + branch-protection / indexing failures ([co-authoring](https://tina.io/docs/tinacloud/git-co-authoring), [troubleshooting](https://tina.io/docs/tinacloud/troubleshooting)).
4. **Sync rewrites / duplicates / dialect drift.** GitBook may emit new MD instead of overwriting; README via UI duplicates; `SUMMARY.md` required for import; app must bypass branch protection ([same troubleshooting](https://gitbook.com/docs/docs-as-code/git-sync/troubleshooting)). HackMD vs GitHub hard vs soft line breaks ([sync docs](https://hackmd.io/@docs/sync-a-note-with-github)). Outline maintainers: GH→Outline is lossy ([discussion #5375](https://github.com/outline/outline/discussions/5375)).
5. **Bot identity + protected main.** GitBook `gitbook-com` and Tina `tina-cloud-app` hide the editor unless “Act as You”. Agents/humans fighting the same branch without a CRDT merge path lose work; MDArena’s answer to external git is cache invalidate + reload (not diff-replay).

X search (`GitBook git sync`, Tina/Decap, HackMD, github.dev): mostly vendor posts; complaints live on GitHub, not Twitter.

## Recommendation

Nobody ships the full design. **GitBook** is the closest productized “web edit + comments + git” but fails the spec: visual blocks (not raw-MD CRDT), CRs ≠ git branches/PRs, comments off-git, bot commits, duplicate-file export. **HackMD** has the collab/comment UX and optional git push, then drops comments. **Decap/Tina** get git-as-truth and branch-per-draft right and get realtime/comments wrong. **Graft** is the closest OSS *shape* (GitHub login, Tiptap WYSIWYG over MD, Yjs, comments off the content branch). **MDArena** is the closest *architecture* (Yjs working copy, idle flush to git) but polls HEAD and reloads instead of webhook-diff → CRDT ops. Build that missing piece: `Y.Text` of **raw markdown**, WYSIWYG bound to MD (Milkdown/CodeMirror-MD, not ProseMirror-as-source), GitHub App commits **as the user**, drafts = real branches, comments in your DB keyed by CRDT relative positions. Skip Dolt/Irmin/Noms. Skip putting comments in git unless you want Graft’s orphan-branch trick as a backup.
