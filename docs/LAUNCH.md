# 🚀 Red Letter: launch book (Show HN + Product Hunt + X)

Status: draft 2, 2026-11-09. Product facts come from `docs/DESIGN.md` (Prototype status), `CHANGELOG.md` and the code; competitor facts from `docs/research/launch-competitors.md`. Anything not observed is marked `[INFERENCE]`.

## Your todos (need your accounts or your call)

Decisions:
- [ ] Domain: pick and buy one. Then update both OAuth callback URLs (App `red-letter-diff` + OAuth App "Red Letter"), `RL_ORIGINS` in `~/.config/red-letter/env`, the Cloudflare route, README and DESIGN.
- [ ] Licence: MIT (and claim open source) or none (and don't).
- [ ] Launch date.
- [ ] <!--rl:evqu8d-->Read-only view: go / no-go once it's sized.<!--/rl:evqu8d-->
- [ ] Template repo content: three docs; Claude Code or generic `git push` as the agent in the walkthrough.

GitHub / infra:
- [ ] Create `satanworker/red-letter-template` (public, template flag on) once the content is ready.
- [ ] OAuth App and GitHub App listings: name, logo, description, homepage URL. This is the consent screen a visitor reads right after "Continue with GitHub".
- [ ] Uptime check on `POST https://diff-api.satanworker.com/oauth/token` (a 4xx is healthy, a timeout isn't) with a phone alert. Confirm `Restart=always` in `deploy/red-letter-hub.service`.
- [ ] Cloudflare Web Analytics: create the site, paste the beacon snippet into `web/index.html`.
- [ ] Clean the showcase: delete `README copy.md`, delete the "test" thread in `README.md`, resolve or delete the Russian threads in `docs/research/prior-products.md`, add two English threads (one agent reply) to `docs/DESIGN.md`.

Content:
- [ ] Record the video (shot list below) on the template repo, after the agent-avatar fix.
- [ ] Gallery screenshots (1270×760) and the GIF.
- [ ] Fill in `[name]`, `[host]`, `[template repo]`, `[showcase link]` in the HN text, maker comment and thread.
- [ ] Check the landing page and a read-only doc on a phone.
- [ ] PH draft scheduled; friends told the time (try the template, comment).
- [ ] Link previews: approve the OG image (1200×630: the raw-vs-rendered split or the hero with a thread). Needed before any link goes out; today `web/index.html` has no `og:*` / `twitter:*` tags, so links unfurl as a bare "Red Letter".

## What changed from draft 1, and why

Draft 1's assumptions, challenged:

| Assumption | Problem | Now |
|---|---|---|
| PH + X are the channels. | The products shaped like ours (swap a host on a GitHub URL, read what's there) won on Hacker News, not PH: github1s 1,692 pts, GitIngest 185; DeepWiki was PH #13 and spread on X instead. PH winners with a GitHub gate (Graphite, CodeRabbit) sold a workflow on your PRs with a team and a following behind them. | Show HN is the primary channel, same day as PH and X. PH stays; expect a top-20 day, not #1, and don't optimise the product for it. |
| Lead with "git is the source of truth". | That's architecture. The buyer's pain is reviewing markdown that agents wrote. | Lead with the pain; "git is truth" is the trust line underneath. |
| Four proof points in fixed order. | Two of them had false precision: "byte-for-byte markdown" is wrong once a comment adds `<!--rl:…-->` markers; "the token never leaves the browser" is wrong, the hub sees it to check push access and to exchange the OAuth code (it stores nothing). HN will catch both. | Reworded below. |
| A public demo repo is the try path. | A stranger on our repo has no push access: read-only, no comments, no live sync. They can look, not try. | Showcase (our repo, read-only) **and** a template repo: "Use this template" gives the visitor a repo they own, so edit, comment, autosave and `git push` all work in two minutes. The Tina / Keystatic pattern. |
| Anonymous read-only view is the highest-leverage build. | What does a signed-out visitor see? A rendered markdown file with its comment threads and outline. GitHub already renders the file; the threads are the only thing GitHub hides. Modest aha, and signed-out GitHub API calls are capped at 60/h per IP while a tab today polls every ~15 s and syncs the whole branch in the background. | Build a **narrow** version: file + comments from `raw.githubusercontent.com`, no polling, no sidebar, no history, a "sign in to edit" bar. Skip it if it's more than two days `[INFERENCE: not sized]`. The video carries the aha either way. |
| Switch the default sign-in to the GitHub App. | The App only sees repos it's installed on; opening a random file routes to an install page. For a product whose pitch is "swap the host on any file", OAuth's "works on everything" is the point. The real complaint is the `repo` scope (all private repos, read/write). | Keep OAuth default, ask `public_repo` first; offer `repo` only when a private repo needs it. One scope string today (`github.ts:34`) plus a re-auth path on the no-access screen `[INFERENCE: half a day]`. |
| Analytics is P0. | We can read PH comments, hub logs (sign-ins, rooms) and GitHub App installs without it. | Cloudflare Web Analytics on the static site: one script tag, no cookies, 15 minutes. P1. |
| The hub being one process is a P0 because live sync drops. | Live sync dropping is fine (saves go straight to GitHub). The P0 is that the hub also does the OAuth code exchange: hub down = **nobody can sign in**. | Same fix, right reason: restart policy checked, an uptime ping on `/oauth/token` with an alert, hub logs watched on the day. |
| "Agents need nothing installed." | True for pushes. For replying to comments, the agent has to know the thread format (`@login date: ` lines, ` resolved`). Nothing in the repo tells an agent that except a paragraph in DESIGN.md. Shot 5 of the video ("address the comments") depends on it. | Ship `docs/for-agents.md`: a paste-into-AGENTS.md snippet. It's also a launch asset. |
| Comments in the file are purely a plus. | Every comment, resolve and autosave is a commit on the branch. "Red Letter made 40 commits to main today" and "there's HTML in my markdown" will be the top HN objections. Drafts are hidden, so the honest answer is "yes, or use a branch / protected branch". | Answered up front in the maker comment and FAQ, not discovered by commenters. |
| Any domain. | `diff.satanworker.com` is the URL in every screenshot, tweet and HN title. "satanworker" reads as a joke handle to a US audience; "diff" says nothing. `[INFERENCE]` | Buy a domain. Changes: two OAuth callback URLs (App + OAuth App), `RL_ORIGINS` on the hub, the Cloudflare route, README. Half a day. |
| Launch at 00:01 PT Tue–Thu, line up a hunter. | Received PH wisdom from 2022; PH reworked launches and de-emphasised hunters since. Unverified. | Self-hunt; post when the US wakes up (Show HN peaks 8–11 am ET); PH at 00:01 PT the same day. |

## Positioning

**One line:** your agents write markdown into git; review it with your team live, in the margin, in the file itself.

**Landing headline (live today):** "Write together. Agents included."

**Who:** developers whose specs, plans and research notes are `.md` in a repo and increasingly written by coding agents. Solo first (PH/HN audience), teams second; the product today edits a branch live with autosave, which solo devs love and teams will ask about (see FAQ).

**Pain, in their words:** the agent pushed `plan.md`. Reviewing it means a PR diff where comments only attach to changed lines, or pasting it into a Google Doc that drifts from the repo by lunch.

**Proof points** (same order everywhere):
1. **Open the file where it lives.** Swap `github.com` for our host on any markdown link. No import, no sync, no database: a save is a commit on your branch.
2. **Agents keep using `git push`.** Their commit lands in every open tab within seconds, merged character by character with what people are typing; only words both sides changed get flagged (keep yours / keep the agent's / keep both).
3. **Comments are pull request reviews.** Select text, comment, and it's a GitHub review comment on a PR: the first comment opens one (from a review branch when you're on main), so Claude Code, Codex and your reviewers see it where they already look, and Approve and Merge are the PR's. Prefer comments in the file itself, as HTML comments agents read with the text? One toggle, remembered per repo.
4. **Your markdown isn't rewritten.** Live preview over the raw text, not a rich-text tree that reformats your lists. The only thing added is the comment markup, and only where you comment.

**Trust line:** nothing is stored outside your repo. Tokens live in your browser; the relay checks your push access and exchanges the sign-in code, keeps nothing, and only admits people who can push.

**Versus:** Gether (closest: git-native, real-time, GitHub App) comments on PRs and has no agent-push merge or CRDT; Proof, Skilldocs, Glyphdown (agents + humans on docs) aren't git-backed; HackMD and GitBook keep the doc in their database and lose comments on sync.

## Try paths (in order of what a visitor can do)

1. **Watch** (0 s): the video, in the HN text, the PH gallery and tweet 1.
2. **Look** (10 s): the showcase, our own repo's docs, with real human↔agent threads. Signed out if the narrow read-only view ships; after one OAuth click otherwise.
3. **Try** (2 min): `Use this template` on `satanworker/red-letter-template` → a repo you own → swap the host → edit, comment, see the commit on GitHub, `git clone`, edit, `git push`, watch it land. The template's README walks through exactly that and includes the agent snippet.
4. **Use**: swap the host on a file in your own repo.

Never a publicly writable shared repo (HedgeDoc tried; malware and DMCA followed).

## Readiness

| # | Item | State / action |
|---|---|---|
| P0 | **Template repo** `red-letter-template`: 3 docs (a plan with an open thread, a spec with a resolved one, a README that is the walkthrough), `AGENTS.md` with the comment snippet, GitHub's template flag on. | Not started. |
| P0 | **Link previews.** `web/index.html` has no `og:title` / `og:description` / `og:image` / `twitter:card`; links unfurl as a bare "Red Letter" everywhere. | Add the tags and a 1200×630 `og.png` to the static site (`summary_large_image`). One card for the whole site: the app is static with no Worker code, so per-doc cards (doc title + icon) need a Worker that rewrites the tags per path; later, if shared doc links matter. |
| P0 | **Showcase content.** Our repo is public, but `README copy.md` is a test artifact, `README.md` has a "test" thread, and `docs/research/prior-products.md` has Russian threads. | Delete the copy, resolve or delete test threads, add two real English threads (one agent reply) on `docs/DESIGN.md`. |
| P0 | **`docs/for-agents.md`:** the comment format for agents, pasteable. Linked from the landing page and the template. | Not started; content exists in DESIGN.md "Comments" and "Agent:" paragraph. |
| P0 | **Sign-in availability.** Hub exchanges OAuth codes; if it's down nobody signs in. | Confirm `Restart=always` in `deploy/red-letter-hub.service`; external uptime check on `POST /oauth/token` (expect a 4xx, not a timeout); phone alert. |
| P0 | **Scope.** OAuth asks `repo` (all private repos, read/write) on the first click. | Ask `public_repo`; re-auth with `repo` from the no-access screen for private repos. |
| P0 | **No-access and sign-in screens** are dead ends for a visitor ("Your GitHub account can't see …"). | Add: "You can read this file once signed in; to edit, you need push access. Try it on your own copy: Use this template." |
| P1 | **Narrow read-only view** for public repos, signed out: file + comments via `raw.githubusercontent.com`, no polling, "Sign in to edit" bar. | Build if ≤ 2 days `[INFERENCE]`; else skip. |
| P1 | **Domain.** | Buy; update both OAuth callbacks, `RL_ORIGINS`, Cloudflare route, README, DESIGN. |
| P1 | **Agent avatars** can be a stranger's (looked up by git author name). It'll be on screen when the agent pushes in the video. | Show an initial. In DESIGN's *Not built yet*. |
| P1 | **Landing page examples.** The input says "paste a link" to someone who has none in mind. | Three chips under the input: our DESIGN.md, the template's plan, one more. |
| P1 | **Analytics.** | Cloudflare Web Analytics on the static site. |
| P1 | **Mobile.** PH and X traffic is heavily mobile; the landing page and read-only doc must not be broken on a phone. The editor can say "open on a desktop to edit". | Check on a phone; fix the landing at least. `[INFERENCE: untested]` |
| P1 | **Licence.** No LICENSE in the repo. Not needed to launch; needed to say "open source". | Decide (below). If yes: MIT, plus a visitor README. |
| P2 | **Hub load.** | A few hundred WebSocket clients across rooms once; watch `journalctl --user -u red-letter-hub` on the day. |
| P2 | **OAuth App consent screen.** Name, logo and description are the first thing a visitor reads after clicking "Continue with GitHub". | Check the OAuth App's settings; the GitHub App's listing too. |

## Assets

**Video, 60–90 s, captions, no voice.** Record on the template repo (not `demo`: the template is what visitors will see next).
1. A GitHub file page. Edit the URL host. Same doc opens in the editor. (5 s)
2. Two windows, two people typing, presence avatars. (10 s)
3. Terminal: agent edits the file, `git push`. Lands in both windows while one person types. One word collides, flagged; "Keep yours". (20 s)
4. Select text → Add a comment → send. Cut to the raw file on GitHub: an HTML comment, invisible on the rendered page. (15 s)
5. Terminal: `claude "address the comments in plan.md"`. The agent replies in the thread and pushes; the reply appears in the panel. Needs `docs/for-agents.md` in the repo. (15 s)
6. History tab: click a commit, see its diff. (5 s)
7. End card: "Red Letter. Write together. Agents included." + URL. (5 s)

**PH gallery (1270×760):** hero with a human↔agent thread; GIF of shot 3; raw-vs-rendered split ("GitHub hides them, agents read them"); History tab; the URL swap in big type; dark mode with a mermaid diagram and a table.

**X media:** the video uploaded natively; the GIF; the split screenshot.

## Show HN

**Title** (≤ 80 chars): `Show HN: Red Letter – live co-editing and comments on markdown in GitHub repos` (78)

**Text:**

> I'm [name]. My coding agents write half the markdown in my repos now (plans, specs, research), and reviewing it was the worst part of my day: PR comments only attach to changed lines, and pasting into Google Docs gave me two copies that drifted.
>
> Red Letter puts a multiplayer editor on the file itself. Swap github.com for [host] on any markdown link.
>
> - A save is a commit on your branch (30 s after the last edit, or ⌘S). No database.
> - Agents keep using git push. Their commit is merged into every open tab live (Automerge; the push is replayed at the heads of its parent commit, so in-flight typing isn't treated as a deletion). Only words both sides changed are flagged.
> - Comments are HTML comments in the file: hidden on GitHub's rendered page, read by agents. There's a snippet for your AGENTS.md so "address the comments" works.
> - Live preview over the raw markdown, not a rich-text tree, so the file isn't reformatted.
>
> Honest caveats: every save and every comment is a commit, so a busy doc makes a busy history (use a branch; on a protected branch the doc is read-only and comments go through one PR per doc). Comment markup sits in your source. Sign-in is GitHub OAuth; the relay sees your token to check push access and stores nothing.
>
> Try it: [template repo] → Use this template → open it at [host]. Or read [showcase link] first.
>
> Stack: Solid, CodeMirror 6, Automerge 3.5, a 300-line Go relay. Design notes: [DESIGN.md link].

Post 8–10 am ET. Answer every comment for the first three hours; the people who ask about commit noise, CRDT determinism and the `repo` scope are the audience.

## Product Hunt

- **Name:** Red Letter
- **Tagline** (≤ 60): "Review your agents' markdown live, in the file, in GitHub" (56). Alternatives: "Write together in your GitHub repo. Agents included." (52).
- **Description** (≤ 260): "Open any markdown file from GitHub, edit it live with your team and comment in the margin. Every save is a real commit and comments live in the file. Your AI agents keep using git push; their edits merge into open tabs live."
- **Topics:** Developer Tools, GitHub, Artificial Intelligence, Writing, Open Source (only if licensed)
- **Links:** showcase doc first, template repo second. Not the bare landing page.
- **Pricing:** Free.

**Maker comment:** the Show HN text, with the first paragraph as is, the stack line dropped, and this at the end: "Not there yet: cursors in the text (avatars only), mention notifications, drafts as PRs, read-only links for people without GitHub. Which would you want first?"

Self-hunt. Ask friends to try the template and comment, not to upvote.

## X thread (6 tweets)

1. > Your agents write markdown into git. You review it in Google Docs. Someone copy-pastes between the two.
   >
   > Red Letter: live co-editing and margin comments on the .md files in your GitHub repo. Agents keep using git push.
   >
   > [video]

2. > Swap github.com for [host] on any markdown link. The file opens in a multiplayer editor. A save is a commit on your branch. No database, no import.

3. > Agents don't need an SDK. git pull, edit, git push.
   >
   > Their commit lands in every open tab live, merged character by character with what you're typing. Where you both touched the same words, you pick.
   >
   > [GIF]

4. > Comments are HTML comments in the file. GitHub's page hides them; agents read them.
   >
   > Paste one snippet into AGENTS.md and "address the comments in plan.md" just works.
   >
   > [split screenshot]

5. > Nothing is stored outside your repo. Tokens live in your browser; the relay checks push access and keeps nothing.
   >
   > Caveat we'll say ourselves: every save is a commit. Use a branch if that bothers you.

6. > Try it in two minutes: [template repo] → Use this template → open it at [host].
   >
   > Show HN: [link] · Product Hunt: [link]

Replies to keep ready: the perf table from DESIGN.md (17k-line doc, 31 ms a keystroke vs 21 ms for a textarea), a 10 s clip of a conflict flag, `docs/for-agents.md`.

## FAQ (paste-ready)

- **Won't this spam my git history?** Edits: one commit per save (30 s after the last edit) on the branch you're on. Comments: none on your text; they're PR review comments (the first one opens the PR, and a file nobody changed gets one newline appended so GitHub lets the PR review it). Edit on a branch and squash, or use a protected branch: the doc opens read-only there.
- **It edits main directly?** It edits the branch in the URL. Protected branches are read-only. Comments never edit the text; they go to a PR.
- **There's HTML in my markdown now?** Only if you switch comments to "In the file": markers around the text and a thread block at the end, invisible on GitHub's rendered page, plain text to agents and linters. Delete a thread and the markup goes. The default keeps comments on the PR.
- **Why `repo` scope?** It asks for `public_repo` first; `repo` only if you open a private repo, because GitHub OAuth has no per-repo scope. Prefer per-repo access? "Use the GitHub App instead" installs on the repos you pick. Tokens stay in your browser; the relay stores nothing.
- **Where's my data?** In your repo: the file (comments included) on your branch, the live-editing history in `refs/red-letter/…` in the same repo. The relay is in-memory.
- **How does the agent know the comment format?** `docs/for-agents.md`: a thread is `<!--rl:id\n@login date: text\n-->`; reply by adding a `@login: ` line, resolve by adding ` resolved` to the first line.
- **What if an agent and I change the same sentence?** Both edits merge; the words you both changed are flagged and you choose.
- **How's this different from Gether / HackMD / GitBook?** Gether is git-native and real-time but comments on PRs and doesn't merge agent pushes into live sessions. HackMD and GitBook keep the doc in their database and sync to git; comments stay behind.
- **Work account says no access?** Your org restricts OAuth apps; request approval in GitHub's settings (the no-access screen links it) or use the GitHub App.
- **Mobile?** Read on a phone; edit on a desktop.
- **Open source?** [Decision below.]
- **Pricing?** Free.

## Launch day runbook

| When | What |
|---|---|
| T-7 d | Decisions made; P0 done; template repo public; video and gallery done; PH draft scheduled. |
| T-2 d | Fresh GitHub account: template → open → edit → comment → `git push` from a clone → agent reply. Both sign-in paths. Phone check. Hub uptime alert live. |
| T-1 d | Freeze `main` (deploys are automatic on push). Tell friends the time; ask them to try the template. |
| 00:01 PT | PH live; maker comment. |
| 08:00 ET | Show HN; X thread; pin it. |
| First 3 h | Answer everything on all three. Watch hub logs and sign-in failures. |
| Evening | X follow-up with what people asked for most. |
| T+1 d | Numbers and top requests, here. |

## What we measure

Cloudflare Web Analytics: visits, landing → doc, country, device. Hub logs: OAuth exchanges (OAuth vs App), rooms opened. GitHub: template uses, App installs, stars. HN points and comments; PH rank; X views and profile clicks.

## Open decisions

1. **Narrow read-only view:** build if ≤ 2 days, else rely on the video and the one-click sign-in. Needs sizing against `repoStore.ts` / `docStore.ts` first.
2. **Open source:** MIT + visitor README, or stay unlicensed and don't claim it. HN rewards open source; PH doesn't need it; claiming it without a licence gets caught (Mintlify).
3. **Domain:** which one.
4. **Template repo content:** which three docs, and whether the "agent" in the walkthrough is Claude Code specifically or a generic `git push`.
5. **Date.**

<!--rl:evqu8d
@satanworker 2026-11-09T12:32Z: wait what does that mean? What do we need to size?
-->
