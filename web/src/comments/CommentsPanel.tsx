// Comment threads beside the doc. Rows are keyed by thread id, so a reply being typed survives updates.
// New comments are written in the editor (Editor.tsx) and show here once sent.
// Keyboard: each thread's quote is a button that jumps to the text; Reply / Resolve / Reopen / Delete are buttons;
// Esc closes inputs. Resolved threads wait, collapsed, under "N resolved"; hovering one's card lights up its text.
import { For, Show, createMemo, createSignal, type Accessor } from "solid-js";
import { deleteThread, doc, hoverThread, reopenThread, resolveThread, selectThread, submitReply } from "../doc/docStore.ts";
import { repo } from "../repo/repoStore.ts";
import { Avatar, ago, badge, btn, card, linkBtn } from "../ui.tsx";
import type { Message as Msg, Thread } from "./inline.ts";
import { MentionText, createMentions } from "./Mentions.tsx";
import { comments, setCommentsMode, type Mode } from "./commentsStore.ts";

type Submit = SubmitEvent & { currentTarget: HTMLFormElement };

// Figma 11:356: 2px #d9d9d9 bar, 8px gap, Shadows-grey text, three lines at most
const quote = "line-clamp-3 border-l-2 border-on pl-2 text-left whitespace-pre-wrap text-muted";

export function CommentsPanel(props: { canComment: boolean; threads: Accessor<Thread[]> }) {
  // Each keystroke above a thread moves its range, so every Thread is new; a card only needs the rest. Keeping the
  // last frame's object for a thread whose card would look the same leaves its card untouched.
  const byId = createMemo<Map<string, Thread>>((prev) => {
    const next = new Map<string, Thread>();
    for (const t of props.threads()) {
      const p = prev.get(t.id);
      const same = p && p.quote === t.quote && p.messages === t.messages && p.resolved === t.resolved && p.pr?.outdated === t.pr?.outdated && !p.range === !t.range && (p.range?.from === p.range?.to) === (t.range?.from === t.range?.to);
      next.set(t.id, same ? p : t);
    }
    return next;
  }, new Map());
  const ids = (resolved: boolean) => props.threads().filter((t) => t.resolved === resolved).map((t) => t.id);
  const open = createMemo(() => ids(false));
  const resolved = createMemo(() => ids(true));
  // selecting goes to the thread's range now, which a kept card object may hold an older copy of
  const select = (id: string) => selectThread(props.threads().find((t) => t.id === id)!);
  const cards = (list: Accessor<string[]>) => (
    <For each={list()}>{(id) => <Show when={byId().get(id)}>{(t) => <ThreadCard thread={t} canComment={props.canComment} select={() => select(id)} />}</Show>}</For>
  );
  // On a branch with a pull request, new comments go to it or into the file (remembered per repo). Without edit
  // rights only the PR takes them. Styled like the panel's tabs: the chosen one white, the other a grey outline.
  const fileLocked = () => !(doc.session?.canWrite || comments.viaPr);
  const modeBtn = (mode: Mode, label: string) => (
    <button
      type="button"
      class={`inline-flex h-6 cursor-pointer items-center whitespace-nowrap rounded-[14px] px-3 text-fg disabled:cursor-default disabled:text-faint ${comments.mode === mode ? "bg-card shadow-figma" : "border-[.4px] border-line bg-side"}`}
      aria-pressed={comments.mode === mode}
      disabled={mode === "file" && fileLocked()}
      title={mode === "file" && fileLocked() ? "You can't edit this branch" : undefined}
      onClick={() => setCommentsMode(mode)}
    >
      {label}
    </button>
  );
  return (
    <>
      <Show when={doc.pr}>
        <div class="flex gap-2 px-0.5" role="group" aria-label="Where new comments go">
          {modeBtn("pr", "On the pull request")}
          {modeBtn("file", "In the file")}
        </div>
      </Show>
      <Show when={!open().length}>
        <p class="px-0.5 py-3 text-muted">
          Select text and click <b>Add a comment</b> to start a discussion.
        </p>
      </Show>
      {cards(open)}
      <Show when={resolved().length}>
        <details>
          <summary class="cursor-pointer list-none px-0.5 text-muted hover:text-fg">{resolved().length} resolved</summary>
          <div class="mt-4 flex flex-col gap-4">{cards(resolved)}</div>
        </details>
      </Show>
      <Show when={comments.sending}>
        <p class="text-muted">Sending to the pull request…</p>
      </Show>
      <Show when={comments.error}>
        <p class="text-red [overflow-wrap:anywhere]">{comments.error}</p>
      </Show>
      {/* Figma 14:428 */}
      <p class="flex flex-col gap-2 py-1 text-muted">
        <Show
          when={comments.viaPr}
          fallback={
            <Show
              when={doc.pr}
              fallback="Comments are HTML comments in the file: hidden on GitHub's page, read by agents with the text. Resolved ones stay in the file until deleted."
            >
              {(pr) => (
                <span>
                  <Show
                    when={comments.mode === "pr" || !doc.session?.canWrite}
                    fallback="New comments go into the file as HTML comments: hidden on GitHub's page, read by agents with the text. Resolved ones stay in the file until deleted."
                  >
                    New comments go to{" "}
                    <a class="underline" href={pr().url} target="_blank">
                      pull request #{pr().number}
                    </a>{" "}
                    as review comments on this file; they never change the file. On text the pull request didn't change, GitHub takes them as comments on the whole file.
                  </Show>
                </span>
              )}
            </Show>
          }
        >
          <span>
            {repo.branch} is protected, so comments go through{" "}
            <Show when={comments.pr} fallback="a pull request, opened by the first one.">
              {(pr) => (
                <>
                  <a class="underline" href={pr().url} target="_blank">
                    pull request #{pr().number}
                  </a>
                  .
                </>
              )}
            </Show>{" "}
            Merging it lands them in the file as HTML comments, hidden on GitHub's page.
          </span>
        </Show>
      </p>
    </>
  );
}

// Figma 15:440: avatar 24 + name / time, the body 12px below
const Message = (props: { m: Msg }) => (
  <div class="flex flex-col gap-3">
    <div class="flex items-center gap-2">
      <Avatar login={props.m.author} size={24} />
      <div class="flex flex-col">
        <span>{props.m.author}</span>
        <span class="text-muted">{props.m.at && ago(props.m.at)}</span>
      </div>
    </div>
    <div class="break-words whitespace-pre-wrap">
      <MentionText text={props.m.body} />
    </div>
  </div>
);

function ThreadCard(props: { thread: Accessor<Thread>; canComment: boolean; select: () => void }) {
  const t = props.thread;
  const removed = () => !t().range || t().range!.from === t().range!.to;
  const [replying, setReplying] = createSignal(false);
  let input!: HTMLInputElement;
  const mentions = createMentions(() => input, () => {});
  const reply = (e: Submit) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    input.value = "";
    setReplying(false);
    submitReply(t().id, body);
  };
  return (
    <div
      // content-visibility: a card outside the panel's view skips layout and paint (a long doc has hundreds; drawing
      // them all cost the doc's scrolling 25 ms of paint bookkeeping a jump)
      class={`${card} cursor-pointer gap-6 [contain-intrinsic-size:auto_160px] [content-visibility:auto] ${t().id === doc.activeThread ? "shadow-[0_0_0_2px_rgba(223,171,1,.55),var(--shadow)]" : ""}`}
      onClick={(e) => {
        if (!(e.target instanceof Element && e.target.closest("form, button"))) props.select();
      }}
      onMouseEnter={() => t().resolved && hoverThread(t().id)}
      onMouseLeave={() => hoverThread("")}
    >
      <div>
        <button type="button" class={`${quote} cursor-pointer`} title="Go to the text" onClick={() => props.select()}>
          {t().quote.slice(0, 120)}
        </button>
        <Show when={removed()}>
          <span class="mt-0.5 block text-muted">· text was removed</span>
        </Show>
        {/* only while both kinds can be around: a thread on the PR, or in the file next to PR ones */}
        <Show when={doc.pr}>
          {(pr) => (
            <span class="mt-1 flex gap-1.5 text-muted">
              <span class={`${badge} px-1.5`}>{t().source === "pr" ? `on PR #${pr().number}` : "in file"}</span>
              <Show when={t().pr?.outdated}>
                <span class={`${badge} px-1.5`} title="GitHub lost track of the lines; placed here by the comment's quote, if found">
                  outdated
                </span>
              </Show>
            </span>
          )}
        </Show>
      </div>
      <For each={t().messages}>{(m) => <Message m={m} />}</For>
      <Show when={props.canComment}>
        {/* Figma 22:561: pushing Reply shows the reply box with Comment (= send) and Cancel */}
        <Show
          when={replying()}
          fallback={
            <div class="flex items-center gap-3">
              <Show
                when={!t().resolved}
                fallback={
                  <button type="button" class={btn} onClick={() => reopenThread(t().id)}>
                    Reopen
                  </button>
                }
              >
                <button type="button" class={btn} onClick={() => setReplying(true)}>
                  Reply
                </button>
                <button type="button" class={btn} onClick={() => resolveThread(t().id)}>
                  Resolve
                </button>
              </Show>
              <button
                type="button"
                class={`${linkBtn} ml-auto`}
                onClick={() => confirm(`Delete this comment and its replies?${t().source === "pr" ? " GitHub deletes them for good." : " Git history keeps them."}`) && deleteThread(t().id)}
              >
                Delete
              </button>
            </div>
          }
        >
          <form class="flex flex-col gap-5" onSubmit={reply}>
            <div class="relative">
              <input
                ref={(el) => ((input = el), requestAnimationFrame(() => el.focus()))}
                aria-label="Reply"
                placeholder="Reply"
                class="h-7 w-full rounded-lg border-[.4px] border-line px-2 outline-none placeholder:text-muted"
                onInput={mentions.update}
                onClick={mentions.update}
                onKeyDown={(e) => mentions.onKey(e) || (e.key === "Escape" && setReplying(false))}
              />
              <mentions.List />
            </div>
            <div class="flex items-center gap-1">
              <button class={btn}>Comment</button>
              <button type="button" class="h-6 cursor-pointer rounded-[14px] px-3 hover:bg-hover" onClick={() => setReplying(false)}>
                Cancel
              </button>
            </div>
          </form>
        </Show>
      </Show>
    </div>
  );
}
