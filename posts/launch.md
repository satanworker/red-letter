# 🖋️ Red Letter: write together, agents included

*Draft for the launch blog. Target: 1,200 words. Owner: satanworker. Status: first draft, not edited.*

## The problem

Most of the writing a software team does now happens in markdown, in a git repository. Specs, plans, design notes, research, READMEs. And more and more of that markdown is written by coding agents: Claude Code drafts the plan, Codex rewrites the spec, Cursor updates the README after the refactor.

That is great for speed. It is terrible for review. When an agent pushes a 400 line plan, the humans who need to read it have two bad options. They can read it in the GitHub pull request view, where comments can only attach to lines that changed and the text is shown as a diff instead of as a document. Or they can copy it into Google Docs, comment there, and then somebody has to carry the comments back into the repository by hand. By lunch time there are two copies and nobody is sure which one is right.

We kept hitting this ourselves. Every week we lost an hour or two to moving text between the repo and a doc. Every week a comment got lost in the move.

## What Red Letter is

Red Letter is a live editor for the markdown files that already live in your GitHub repository. You open any file by changing the host in its URL: github.com becomes our domain, and the same file opens in an editor that several people can type in at once, with comments in the margin.

There is no import step and no sync button. The file in git is the document. When you stop typing, Red Letter saves a real commit to the branch you are on. When you close the tab, the file on GitHub is exactly what you saw.

## How agents fit in

Agents do not need a plugin, an SDK or an MCP server. They keep doing what they already do: git pull, edit the file, git push.

When an agent pushes, its commit shows up in every open tab within seconds. Red Letter merges it into what people are typing character by character, using a CRDT. If the agent and a person changed different words, both changes simply land. If they changed the same words, Red Letter highlights the overlap and asks a human to pick: keep yours, keep the agent's, or keep both.

This works because of one small trick. We do not diff the agent's commit against the live document, which would treat everything a person typed since as a deletion. We replay the agent's commit on top of the state the document was in when the agent started, and then merge the two histories. Every tab does the same replay, so they all end up with the same text.

## Comments

Comments are where we spent the most time, and where we changed our minds the most.

Our first version stored comments as HTML comments inside the markdown file itself. GitHub hides HTML comments when it renders a page, so the published file looks clean, and agents read the comments along with the text. You can ask an agent to address the comments in plan.md and it just works.

That turned out to be exactly right for internal documentation, and exactly wrong for publishing. For a blog post or a public doc you do not want review notes travelling with the text, even hidden ones. So now there are two modes. In the file, for living documents your team and your agents keep editing. On a pull request, for anything that gets reviewed and then shipped: the comments become ordinary GitHub review comments, and the text stays clean.

## Reviewing a change

When someone proposes a change, they open a branch and a pull request, from Red Letter or from git. Red Letter lists the open pull requests in the sidebar, the same way the GitHub extension for VS Code does. Unfold one and you see the files it changes. Open a file and you see the document, not a diff: new text is highlighted, removed text is shown struck through where it used to be, and the review comments sit in the margin next to the words they are about.

Approve, request changes and merge all go through GitHub, so your branch protection and required reviews keep working.

## A day with Red Letter

Here is what a normal day looks like for us now.

At nine, an agent picks up a ticket and writes a plan for it in plans/billing-retries.md. It pushes the plan to a branch and opens a pull request. Nobody has to tell anyone; the pull request shows up in the sidebar for everyone who has the repository open.

At ten, the engineer who owns billing opens the plan. She reads it as a document, not as a diff, because it is a new file and there is nothing to diff against. She selects a sentence about exponential backoff and writes a comment: should this cap at five minutes or ten. She selects the table of error codes and writes another: this is missing the 429 case. Both comments become review comments on the pull request.

At eleven, the agent picks up the review comments, the same way it picks up review comments on code. It edits the plan and pushes. Red Letter shows the new text highlighted, with the old text struck through where it used to be, so the engineer can see exactly what changed in answer to her comments without reading the whole plan again.

At noon, a product manager opens the same plan from a link in Slack. He doesn't use git and doesn't need to. He reads it, fixes a typo directly, and leaves a comment asking whether customers get an email when a retry fails. His fix becomes a commit on the branch, signed with his name.

At two, the engineer resolves her two threads, approves the pull request, and merges it. The plan is on main. The comments are on the pull request, where they belong, and the plan itself contains nothing but the plan.

None of this needed a meeting, a doc link, or anyone copying text from one place to another.

## Under the hood

Red Letter has no database. Everything it knows is in your repository.

The text of a document is the file on your branch. The live editing history, which is what lets several people and several agents type at once without stepping on each other, is stored next to it in a git ref that GitHub doesn't show in its interface. Comments are either in the file or on a pull request. Who is looking at what right now is the only thing that lives outside git, and it lives in memory on a small relay server that forgets everything when nobody is connected.

Your GitHub token stays in your browser. The relay never stores it. It uses it once, when you connect, to check that you can push to the repository, because anyone who can join a live session can change the text that ends up in a commit.

When you open a file, Red Letter reads the latest saved state from git, replays any commits that happened since, and connects you to the live session. If you are offline, it opens the copy in your browser and saves when you are back. We measured typing latency on a 17,000 line document at about 31 milliseconds per key, against about 21 for a plain browser text box.

## Questions we keep getting

Does it work with private repositories? Yes, as long as you can access them on GitHub. Organisations that restrict third-party apps need to approve Red Letter first.

Does every keystroke make a commit? No. Red Letter saves about thirty seconds after you stop typing, or when you press save. On a busy document that is still a lot of commits, which is one more reason to edit on a branch and squash when you merge.

What happens if two people change the same sentence? Both changes are kept, and the overlap is highlighted for someone to settle.

Can people without a GitHub account read a document? Not yet. It is the most requested feature and the next one we are building.

## What it is not

Red Letter is not a CMS. It does not publish your site; your existing build does that from the repository, as it does today.

It is not a rich text editor either. Every rich text editor we tried rewrote our markdown on the way in and out: lists renumbered, emphasis markers swapped, tables reformatted. In a repository that agents also edit, that noise shows up in every diff. Red Letter edits the raw markdown and only styles it on screen.

## Why now

Two years ago most of the markdown in a repo was written by people, slowly, and reviewed rarely. Today a single agent session can produce more prose than a team writes in a week. The bottleneck has moved from writing to reading. We think the reading tools have not caught up, and that the place to fix it is the repository itself, not another app that copies text out of it.

## Try it

Pick any markdown file in a repository you can push to. Change github.com to our domain in the URL. Invite a teammate. Ask your agent to push a change while you both type.

It is free while we figure out what people need. Tell us what breaks.
