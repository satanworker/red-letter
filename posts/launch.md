# 🖋️ Red Letter: write together, agents included

*Launch post. Edited for publication.*

## The problem

Most of what a software team writes now lives as markdown in a git repository: specs, plans, design notes, research, READMEs. More and more of it is written by coding agents. Claude Code drafts the plan, Codex rewrites the spec, Cursor updates the README after the refactor.

That is great for speed and terrible for review. When an agent pushes a 400-line plan, the people who need to read it have two bad options. They can read it in the GitHub pull request view, where comments can only attach to lines that changed and the text is shown as a diff instead of as a document. Or they can copy it into Google Docs, comment there, and then somebody has to carry the comments back into the repository by hand. By lunch there are two copies, and nobody knows which one is right. Stress test typing here and more typing now

## What Red Letter is

Red Letter is a live editor for the markdown files already in your GitHub repository. Change the host in a file's URL and the same file opens in an editor fast typing in review several people can type in at once, with comments in the margin.
And  I can also edit that immiedately right? 

There is no import step and no sync button. The file in git is the document. When you stop typing, Red Letter saves a real commit to the branch you are on. Close the tab, and the file on GitHub is exactly what you saw.

## How agents fit in

Agents need no plugin, SDK or MCP server. They keep doing what they already do: `git pull`, edit, `git push`.

When an agent pushes, its commit shows up in every open tab within seconds. Red Letter merges it into what people are typing character by character, using a CRDT (Automerge). If the agent and a person changed different words, both changes simply land. If they changed the same words, Red Letter highlights the overlap and asks a human to pick: keep yours, keep the agent's, or keep both.

One detail makes this work. We do not diff the agent's commit against the live document, which would treat everything a person typed since as a deletion. We replay the agent's commit on top of the state the document was in when the agent started, and then merge the two histories. Every tab performs the same replay, so every tab ends up with the same text.

## Comments

Comments took the most time, and we changed our minds very about them more than once.

Our first version stored comments as HTML comments inside the markdown file itself. GitHub hides HTML comments when it renders a page, so the published file looks clean, and agents read the comments along with the text. You can ask an agent to address the comments in plan.md and it just works.

That is exactly right for internal documentation and exactly wrong for publishing. For a blog post or a public doc you do not want review notes travelling with the text, even hidden ones. So Red Letter has two modes. In the file, for living documents your team and your agents keep editing. On a pull request, for anything that gets reviewed and then shipped: the comments become ordinary GitHub review comments, and the text stays clean.

## Reviewing a change

When someone proposes a change, they open a branch and a pull request, from Red Letter or from git. Red Letter lists the open pull requests in the sidebar, the same way the GitHub extension for VS Code does. Unfold one and you see the files it changes. Open a file and you see the document, not a diff: new text is highlighted, removed text is shown struck through where it used to be, and the review comments sit in the margin next to the words they are about.

Approve, request changes and merge all go through GitHub, so your branch protection and required reviews keep working.

## A day with Red Letter

**9:00.** An agent picks up a ticket and writes a plan in `plans/billing-retries.md`. It pushes the plan to a branch and opens a pull request. The pull request appears in the sidebar for everyone with the repository open; nobody has to announce it.

**10:00.** The engineer who owns billing opens the plan. She reads it as a document, not as a diff, because it is a new file and there is nothing to diff against. She selects a sentence about exponential backoff and asks: should this cap at five minutes or ten? She selects the table of error codes and writes another: this is missing the 429 case. Both comments become review comments on the pull request.

**11:00.** The agent picks up the review comments the way it picks up review comments on code. It edits the plan and pushes. Red Letter shows the new text highlighted, with the old text struck through where it used to be, so the engineer can see exactly what changed in answer to her comments without reading the whole plan again.

**12:00.** A product manager opens the plan from a link in Slack. He doesn't use git, and doesn't need to. He reads it, fixes a typo directly, and leaves a comment asking whether customers get an email when a retry fails. His fix becomes a commit on the branch, signed with his name.

**14:00.** The engineer resolves her threads, and a second reviewer approves and merges. The plan is on main. The comments are on the pull request, where they belong, and the plan itself contains nothing but the plan.

No meeting, no doc link, no copying text between tools.

## Under the hood

Red Letter has no database. Everything it knows is in your repository.

The text of a document is the file on your branch. The live editing history, which is what lets several people and several agents type at once without stepping on each other, is stored next to it in a git ref that GitHub doesn't show in its interface. Comments are either in the file or on a pull request. The only thing outside git is who is looking at what right now, held in memory by a small relay that forgets it when everyone leaves.

Your GitHub token stays in your browser. The relay never stores it. It uses it once, when you connect, to check that you can push to the repository, because anyone who can join a live session can change the text that ends up in a commit.

When you open a file, Red Letter reads the latest saved state from git, replays any commits that happened since, and connects you to the live session. If you are offline, it opens the copy in your browser and saves when you are back. On a 17,000-line document a keystroke takes about 31 ms, against about 21 ms for a plain browser text box.

## Questions we keep getting

**Private repositories?** Yes, any you can access on GitHub. Organisations that restrict third-party apps need to approve Red Letter first.

**Does every keystroke make a commit?** No. Red Letter saves about thirty seconds after you stop typing, or when you press save. On a busy document that is still a lot of commits, which is one more reason to edit on a branch and squash when you merge.

**Two people change the same sentence?** Both changes are kept, and the overlap is highlighted for someone to settle.

**Reading without a GitHub account?** Not yet. It's the most requested feature, and it's next.

## Under the hood

Red Letter has no database. Everything it knows is in your repository.

The text of a document is the file on your branch. The live editing history, which is what lets several people and several agents type at once without stepping on each other, is stored next to it in a git ref that GitHub doesn't show in its interface. Comments are either in the file or on a pull request. The only thing outside git is who is looking at what right now, held in memory by a small relay that forgets it when everyone leaves.

Your GitHub token stays in your browser. The relay never stores it. It uses it once, when you connect, to check that you can push to the repository, because anyone who can join a live session can change the text that ends up in a commit.

When you open a file, Red Letter reads the latest saved state from git, replays any commits that happened since, and connects you to the live session. If you are offline, it opens the copy in your browser and saves when you are back. On a 17,000-line document a keystroke takes about 31 ms, against about 21 ms for a plain browser text box.

## What it is not

Red Letter is not a CMS. Your existing build still publishes your site from the repository.

It is not a rich text editor either. Every rich text editor we tried rewrote our markdown on the way in and out: lists renumbered, emphasis markers swapped, tables reformatted. In a repository that agents also edit, that noise shows up in every diff. Red Letter edits the raw markdown and only styles it on screen.

## Why now

Two years ago, people wrote most of the markdown in a repository, slowly, and reviewed it rarely. Today a single agent session can produce more prose than a team writes in a week. The bottleneck has moved from writing to reading. We think the reading tools have not caught up, and that the place to fix it is the repository itself, not another app that copies text out of it.

## Publishing with Red Letter

This post was written and edited in Red Letter. The draft lived on main. The edit happened on a branch, as a pull request, so the copy editor's changes and the author's replies stayed out of the text until the post was ready. Merging the pull request published it.

## Try it

Pick any markdown file in a repository you can push to. Change github.com to our domain in the URL. Invite a teammate. Ask your agent to push a change while you both type.

It's free during the beta. Tell us what breaks: hello@redletter.dev.
