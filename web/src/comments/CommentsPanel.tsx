// Comment threads beside the doc. Rows are keyed by thread id, so a reply being typed survives updates.
// New comments are written in the editor (Editor.tsx) and show here once sent.
// Keyboard: Up/Down/Home/End move between cards (each card's quote is a button that brings its text into view); Esc on a
// card puts the caret at its text; Reply / Resolve / Reopen are buttons, and each message's "…" opens its menu (Delete,
// Copy link). Esc closes inputs and the menu. Resolved threads wait, collapsed, under "N resolved"; hovering or
// focusing one's card lights up its text.
import { For, Show, createMemo, createSignal, type Accessor } from "solid-js";
import { commentLink, deleteMessage, doc, goToThread, hoverThread, reopenThread, resolveThread, selectThread, submitReply } from "../doc/docStore.ts";
import { repo } from "../repo/repoStore.ts";
import { keyLabel } from "../palette/commands.ts";
import { Avatar, CommentDotsIcon, GithubMarkIcon, GithubStrokeIcon, ago, badge, btn, card, iconBtn, listKeys, rowHover } from "../ui.tsx";
import type { Message as Msg, Thread } from "./inline.ts";
import { MentionText, createMentions } from "./Mentions.tsx";
import { comments, setCommentsMode, targetPr, type Mode } from "./commentsStore.ts";

type Submit = SubmitEvent & { currentTarget: HTMLFormElement };
// a message's "…": pointer down notes whether its menu was open, the click toggles it
type MenuButton = { down: (b: HTMLElement) => void; click: (b: HTMLElement) => void };

// Figma 11:356: 2px #d9d9d9 bar, 8px gap, Shadows-grey text, three lines at most
const quote = "line-clamp-3 border-l-2 border-on pl-2 text-left whitespace-pre-wrap text-muted";
const menuItem = `-mx-1.5 cursor-pointer rounded px-1.5 text-left leading-4 whitespace-nowrap ${rowHover}`;
// Figma 180:386's switch: the track pressed in, the chosen side raised off it
const sunken = "shadow-[inset_1px_2px_4px_rgba(0,0,0,.1),inset_0_-.5px_1px_rgba(0,0,0,.05)]";
const raised =
  "bg-side shadow-[0_.5px_3px_rgba(55,55,55,.09),0_4px_10px_rgba(235,235,235,.25),inset_0_0_.2px_rgba(0,0,0,.32),inset_-.5px_-.5px_1px_rgba(0,0,0,.1),inset_.5px_.5px_1px_rgba(255,255,255,.4),inset_0_-.5px_1px_rgba(0,0,0,.05)]";

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
  // Figma 145:3124: one menu for every message, placed under the "…" that opened it. A native popover: light dismiss,
  // Esc and the top layer come with it. Pressing the "…" whose menu is open closes it (light dismiss closes it on
  // the press, and the click would open it again).
  let menu!: HTMLDivElement;
  const [menuFor, setMenuFor] = createSignal<{ id: string; index: number; button: HTMLElement } | null>(null);
  // Delete asks in the menu itself, not with confirm(): some browsers (embedded ones) turn native dialogs off
  const [asking, setAsking] = createSignal("");
  const shown = () => menu.matches(":popover-open");
  let wasOpen: boolean | undefined;
  const menuButton = (id: string, index: number): MenuButton => ({
    down: (b) => (wasOpen = shown() && menuFor()?.button === b),
    click: (b) => {
      const close = wasOpen ?? (shown() && menuFor()?.button === b);
      wasOpen = undefined;
      if (shown()) menu.hidePopover();
      if (close) return;
      setAsking("");
      setMenuFor({ id, index, button: b });
      const r = b.getBoundingClientRect();
      Object.assign(menu.style, { top: `${r.bottom + 4}px`, right: `${innerWidth - r.right}px` });
      menu.showPopover();
    },
  });
  const del = () => {
    const f = menuFor(), t = f && props.threads().find((x) => x.id === f.id);
    if (!f || !t) return menu.hidePopover();
    const gone = (what: string) => (t.source === "pr" ? ` GitHub deletes ${what} for good.` : ` Git history keeps ${what}.`);
    setAsking(f.index ? `Delete this reply?${gone("it")}` : t.messages.length > 1 ? `Delete this comment and its replies?${gone("them")}` : `Delete this comment?${gone("it")}`);
  };
  const confirmDel = () => {
    const f = menuFor();
    menu.hidePopover();
    setAsking("");
    if (f) deleteMessage(f.id, f.index);
  };
  const copyLink = () => {
    const f = menuFor();
    menu.hidePopover();
    if (f) void navigator.clipboard.writeText(commentLink(f.id));
  };
  const cards = (list: Accessor<string[]>) => (
    <For each={list()}>
      {(id) => <Show when={byId().get(id)}>{(t) => <ThreadCard thread={t} canComment={props.canComment} select={() => select(id)} menu={(i) => menuButton(id, i)} />}</Show>}
    </For>
  );
  // On a branch with a pull request, the switch picks the PR's comments or the file's: the ones shown (in the panel and
  // the text, commentsStore.commentsShown) and where new ones go (remembered per repo). Without edit rights only the
  // PR's. Figma 180:386: a two-way switch in a sunken grey track, the pull request (GitHub's mark) or the Markdown file
  // (MD), the chosen side raised; beside it, what that means.
  const fileLocked = () => !(doc.session?.canWrite || comments.viaPr);
  const chosen = (): Mode => (fileLocked() ? "pr" : comments.mode);
  const side = (mode: Mode) => (
    <button
      type="button"
      role="radio"
      aria-checked={chosen() === mode}
      class={`flex h-5 cursor-pointer items-center rounded-[10px] px-1 disabled:cursor-default ${chosen() === mode ? raised : ""}`}
      disabled={mode === "file" && fileLocked()}
      title={mode === "pr" ? "Pull request" : fileLocked() ? "You can't edit this branch" : "Markdown file"}
      onClick={() => setCommentsMode(mode)}
    >
      <Show when={mode === "pr"} fallback={<span class={`leading-4 ${chosen() === "file" ? "text-fg" : "text-muted"}`}>MD</span>}>
        <Show when={chosen() === "pr"} fallback={<GithubMarkIcon />}>
          <GithubStrokeIcon />
        </Show>
      </Show>
    </button>
  );
  // Up/Down between cards; Esc on a card (outside its reply box): the caret to its text
  const keys = (e: KeyboardEvent) => {
    listKeys(e, "[data-card]");
    const el = e.target as Element, id = el.closest<HTMLElement>("[data-card]")?.dataset.card;
    const t = id && e.key === "Escape" && !e.defaultPrevented && !el.matches("input, textarea") && props.threads().find((t) => t.id === id);
    if (!t) return;
    e.preventDefault();
    goToThread(t);
  };
  return (
    // contents: the cards stay items of the panel's column
    <div class="contents" onKeyDown={keys}>
      <Show when={targetPr() || doc.session?.canWrite}>
        <div class="flex items-start gap-2.5 px-0.5">
          <div role="radiogroup" aria-label="Comments on the pull request or in the file" class={`flex shrink-0 items-center gap-1 rounded-[14px] bg-rule p-0.5 ${sunken}`}>
            {side("pr")}
            {side("file")}
          </div>
          <div class="flex min-w-0 flex-col gap-1">
            <span class="leading-4">{chosen() === "pr" ? "Pull request" : "Markdown file"}</span>
            <span class="text-[8px] text-muted">{chosen() === "pr" ? "Comments will be posted to the pull request." : "Comments will be saved in the Markdown file."}</span>
          </div>
        </div>
      </Show>
      <Show when={!open().length}>
        <p class="px-0.5 py-3 text-muted">
          Select text and click <b>Add a comment</b> (or press {keyLabel("Mod-Alt-m")}) to start a discussion.
        </p>
      </Show>
      {cards(open)}
      <Show when={resolved().length}>
        <details>
          <summary class="cursor-pointer list-none px-0.5 text-muted hover:text-fg">{resolved().length} resolved</summary>
          <div class="mt-4 flex flex-col gap-4">{cards(resolved)}</div>
        </details>
      </Show>
      <div ref={menu} popover role="menu" class="fixed inset-auto m-0 w-[231px] flex-col gap-2 rounded-xl bg-card px-5 py-6 text-fg shadow-[0_4px_17.8px_rgba(0,0,0,.1),var(--shadow)] [&:popover-open]:flex">
        <Show
          when={asking()}
          fallback={
            <>
              <Show when={props.canComment}>
                <button type="button" role="menuitem" class={menuItem} onClick={del}>
                  Delete
                </button>
              </Show>
              <button type="button" role="menuitem" class={menuItem} onClick={copyLink}>
                Copy link
              </button>
            </>
          }
        >
          <p class="leading-4 text-muted">{asking()}</p>
          <button type="button" role="menuitem" class={`${menuItem} text-red`} onClick={confirmDel}>
            Delete
          </button>
          <button type="button" role="menuitem" class={menuItem} onClick={() => setAsking("")}>
            Cancel
          </button>
        </Show>
      </div>
      {/* Figma 14:428 */}
      <p class="flex flex-col gap-2 py-1 text-muted">
        <Show
          when={comments.viaPr}
          fallback={
            <Show
              when={comments.mode === "pr" || (targetPr() && !doc.session?.canWrite)}
              fallback="New comments go into the file as HTML comments: hidden on GitHub's page, read by agents with the text. Resolved ones stay in the file until deleted."
            >
              <span>
                New comments go to{" "}
                <Show when={targetPr()} fallback={<>a pull request as review comments on this file, never into the file itself. The first one opens it{doc.session?.doc.base ? " from this branch" : `: a review of this doc, shared by everyone, back into ${repo.branch}`}.</>}>
                  {(pr) => (
                    <>
                      <a class="underline" href={pr().url} target="_blank">
                        pull request #{pr().number}
                      </a>{" "}
                      as review comments on this file; they never change the file. On text the pull request didn't change, GitHub takes them as comments on the whole file.
                    </>
                  )}
                </Show>
              </span>
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
    </div>
  );
}

// Figma 15:440: avatar 24 + name / time, the body 12px below; 129:1409: the "…" at the top right, when given a menu
// A message still being sent (optimistic) is faded, "Sending…" in its time's place, and has no menu yet.
export const Message = (props: { m: Msg; menu?: MenuButton }) => (
  <div class={`flex flex-col gap-3 transition-opacity ${props.m.pending ? "opacity-60" : ""}`}>
    <div class="flex items-center gap-2">
      <Avatar login={props.m.author} size={24} />
      <div class="flex flex-col">
        <span>{props.m.author}</span>
        <span class="text-muted">{props.m.pending ? "Sending…" : props.m.at && ago(props.m.at)}</span>
      </div>
      <Show when={!props.m.pending && props.menu}>
        {(menu) => (
          <button
            type="button"
            class={`mt-0.5 ml-auto self-start ${iconBtn}`}
            title="More"
            aria-label="More"
            aria-haspopup="menu"
            onPointerDown={(e) => menu().down(e.currentTarget)}
            onClick={(e) => menu().click(e.currentTarget)}
          >
            <CommentDotsIcon />
          </button>
        )}
      </Show>
    </div>
    <div class="break-words whitespace-pre-wrap">
      <MentionText text={props.m.body} />
    </div>
  </div>
);

function ThreadCard(props: { thread: Accessor<Thread>; canComment: boolean; select: () => void; menu: (index: number) => MenuButton }) {
  const t = props.thread;
  const removed = () => !t().range || t().range!.from === t().range!.to;
  const sending = () => (t().pr?.firstCommentId ?? 0) < 0; // shown before GitHub has it: no replies or resolving yet
  const [replying, setReplying] = createSignal(false);
  let input!: HTMLInputElement, el!: HTMLDivElement;
  const mentions = createMentions(() => input, () => {});
  // the reply box closes onto the Reply button, so focus stays on the card
  const closeReply = () => {
    setReplying(false);
    el.querySelector<HTMLElement>("[data-reply]")?.focus();
  };
  const reply = (e: Submit) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    input.value = "";
    closeReply();
    submitReply(t().id, body);
  };
  // a card leaving its list (resolved, reopened, deleted) hands focus to the next card, else the one before, else the tab
  const handOff = () => {
    if (!el.contains(document.activeElement)) return;
    const cards = [...el.parentElement!.querySelectorAll<HTMLElement>(":scope > [data-card]")], i = cards.indexOf(el);
    const next = (cards[i + 1] ?? cards[i - 1])?.querySelector("button");
    (next ?? document.getElementById("tab-comments"))?.focus();
  };
  return (
    <div
      ref={el}
      data-card={t().id}
      // content-visibility: a card outside the panel's view skips layout and paint (a long doc has hundreds; drawing
      // them all cost the doc's scrolling 25 ms of paint bookkeeping a jump)
      class={`${card} cursor-pointer gap-6 [contain-intrinsic-size:auto_160px] [content-visibility:auto] ${t().id === doc.activeThread ? "shadow-[0_0_0_2px_rgba(223,171,1,.55),var(--shadow)]" : ""}`}
      onClick={(e) => {
        if (!(e.target instanceof Element && e.target.closest("form, button"))) props.select();
      }}
      onMouseEnter={() => t().resolved && hoverThread(t().id)}
      onMouseLeave={() => hoverThread("")}
      onFocusIn={() => t().resolved && hoverThread(t().id)}
      onFocusOut={(e) => !el.contains(e.relatedTarget as Node) && hoverThread("")}
    >
      <div>
        <button type="button" class={`${quote} cursor-pointer`} title="Go to the text" onClick={() => props.select()}>
          {t().quote.slice(0, 120)}
        </button>
        <Show when={removed()}>
          <span class="mt-0.5 block text-muted">· text was removed</span>
        </Show>
        {/* where the thread lives, once there's more than the file: its PR, or "in file" next to PR ones */}
        <Show when={t().pr || comments.prs.length}>
          <span class="mt-1 flex gap-1.5 text-muted">
            <Show when={t().pr} fallback={<span class={`${badge} px-1.5`}>in file</span>}>
              {(pr) => (
                <Show when={pr().number} fallback={<span class={`${badge} px-1.5`}>on the pull request</span>}>
                  <a class={`${badge} px-1.5 hover:underline`} href={pr().url} target="_blank" rel="noopener">
                    on PR #{pr().number}
                  </a>
                </Show>
              )}
            </Show>
            <Show when={t().pr?.outdated}>
              <span class={`${badge} px-1.5`} title="GitHub lost track of the lines; placed here by the comment's quote, if found">
                outdated
              </span>
            </Show>
          </span>
        </Show>
      </div>
      <For each={t().messages}>{(m, i) => <Message m={m} menu={props.menu(i())} />}</For>
      <Show when={props.canComment && !sending()}>
        {/* Figma 22:561: pushing Reply shows the reply box with Comment (= send) and Cancel */}
        <Show
          when={replying()}
          fallback={
            <div class="flex items-center gap-3">
              <Show
                when={!t().resolved}
                fallback={
                  <button type="button" class={btn} onClick={() => (handOff(), reopenThread(t().id))}>
                    Reopen
                  </button>
                }
              >
                <button type="button" class={btn} data-reply onClick={() => setReplying(true)}>
                  Reply
                </button>
                <button type="button" class={btn} onClick={() => (handOff(), resolveThread(t().id))}>
                  Resolve
                </button>
              </Show>
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
                onKeyDown={(e) => mentions.onKey(e) || (e.key === "Escape" && closeReply())}
              />
              <mentions.List />
            </div>
            <div class="flex items-center gap-1">
              <button class={btn}>Comment</button>
              <button type="button" class="h-6 cursor-pointer rounded-[14px] px-3 hover:shadow-[inset_0_0_0_.5px_var(--line),var(--shadow)] active:bg-rule" onClick={closeReply}>
                Cancel
              </button>
            </div>
          </form>
        </Show>
      </Show>
    </div>
  );
}
