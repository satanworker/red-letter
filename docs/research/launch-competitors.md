# 🧪 How comparable products let launch visitors try them

2026-11-09. Question: should Red Letter launch with a public demo repo, anonymous read-only viewing, and/or open source? Three research passes (git-backed editors, collaborative markdown editors, GitHub-gated dev tools). Product Hunt pages were blocked from the research environment, so PH ranks and upvotes come from hunted.space; HN scores, repos and docs are primary. Sources are linked per row.

## Findings

**1. Nobody gives strangers a writable shared git repo.** Demos that let you type throw the edits away (Decap's `test-repo` backend keeps them in memory, Tina's demo doesn't persist them, StackEdit keeps them in localStorage). HedgeDoc ran a public writable instance, got malware and DMCA abuse, and switched it to GitHub-only sign-in with a wipe every 24 h ([status post](https://community.hedgedoc.org/t/status-of-the-demo-instance/1634)).

**2. Reading public content without signing in is normal, and the host-swap tools that went viral all allow it.**

| Product | Swap | Works signed out? | Launch result |
|---|---|---|---|
| github1s | `github.com` → `github1s.com` | yes, read-only | [Show HN](https://news.ycombinator.com/item?id=26083919) 1,692 pts |
| GitIngest | `hub` → `ingest` | yes | [Show HN](https://news.ycombinator.com/item?id=42329071) 185 pts |
| DeepWiki | `github` → `deepwiki` | yes for public repos | PH #13, 161 upvotes; spread on X through the URL trick |
| github.dev | `.com` → `.dev` | no | [HN](https://news.ycombinator.com/item?id=28157661) 79 pts |
| Gitpod | `gitpod.io/#<url>` | no ([#6967](https://github.com/gitpod-io/gitpod/issues/6967)) | PH #14, 124 upvotes |

Read-only viewing on any public GitHub link is the shape of Red Letter's own URL swap.

**3. GitHub-gated products that did well on PH used a GitHub App installed on selected repos, not the OAuth `repo` scope.** Graphite (PH #2, 748 upvotes, App only, OAuth retired), CodeRabbit (PH #2, 437), Mintlify (Product of the Day, 359). The `repo` scope drew complaints on launch day for Decap ([HN](https://news.ycombinator.com/item?id=13891756): "r/w access to ALL of my github repositories"), Prose ([#816](https://github.com/prose/prose/issues/816)) and Greptile ([Launch HN](https://news.ycombinator.com/item?id=39604961), "act on your behalf"). Pages CMS launched with `repo` and moved to a GitHub App.

**4. When a product can't run signed out, it opens famous or pre-loaded content first.** Greptile's Launch HN pointed at 100 pre-indexed open-source repos before asking for sign-in. Gether ([gether.md](https://gether.md), the closest cousin: GitHub App, git-native markdown collaboration, AGPL) uses "Sign in with GitHub" plus a live demo of its own README. github1s demoed on its own repo.

**5. Open source helps on HN, but PH winners didn't need it.** github1s (MIT, 23k★), GitIngest (MIT, 16k★), Decap (MIT, launch headline "an open-source CMS") were open-source launches. Graphite, CodeRabbit and DeepWiki are closed. Mintlify claimed "open source" on Launch HN, commenters found a source-available server licence, and the founders walked it back ([thread](https://news.ycombinator.com/item?id=31740724)).

**Agent-era neighbours (2026):** Proof by Every (MIT, no login needed, humans and agents co-edit; [launch](https://every.to/on-every/introducing-proof)), Skilldocs (PH 2026-08-13, #7, 193 upvotes; "Figma for markdown"), Glyphdown (MIT, CLI pull/push for agents), Composer, Copapers. None of them use git as the source of truth; Gether is the only git-backed one.

## What it means for Red Letter

- **Public demo repo: yes, as a read-only showroom; never writable by the public** (finding 1). The best content is our own repo: `satanworker/red-letter` is already public, and its docs have real comment threads and agent commits (finding 4).
- **Anonymous read-only viewing of public repos is the highest-leverage build before launch** (finding 2). Then the PH link and every swapped GitHub URL open with no sign-in screen. Gotcha: signed-out GitHub API calls are capped at 60 an hour per IP, and today a tab polls the branch every ~15 s (240 an hour) and background sync fetches every doc. So signed-out mode needs its own load path, e.g. file content from `raw.githubusercontent.com`, no background sync and slower polling, or reads proxied through the hub with caching. `[INFERENCE: not measured]`
- **Make the GitHub App the default sign-in for launch traffic, with OAuth as the fallback** (finding 3). Today it's the reverse.
- **Open source: optional for PH.** If we say "open source", add a real OSI licence (MIT, or AGPL for copyleft) before launch day (finding 5).
