// Comment threads beside the doc. Rows are keyed by thread id, so a reply being typed survives updates.
// New comments are written in the editor (Editor.tsx) and show here once sent.
// Keyboard: each thread's quote is a button that jumps to the text; Reply / Resolve are buttons; Esc closes inputs.
import { For, Show, createMemo, createSignal, type Accessor } from "solid-js";
import { doc, selectThread, submitReply, toggleResolved } from "../doc/docStore.ts";
import { Avatar, ago, btn, card } from "../ui.tsx";
import type { Thread } from "./commentsSelectors.ts";
import type { Comment } from "./commentsService.ts";
import { MentionText, createMentions } from "./Mentions.tsx";
import { comments } from "./commentsStore.ts";

type Submit = SubmitEvent & { currentTarget: HTMLFormElement };

// Figma 11:356: 2px #d9d9d9 bar, 8px gap, Shadows-grey text, three lines at most
const quote = "line-clamp-3 border-l-2 border-on pl-2 text-left whitespace-pre-wrap text-muted";

export function CommentsPanel(props: { canWrite: boolean; threads: Accessor<Thread[]> }) {
  const byId = createMemo(() => new Map(props.threads().map((t) => [t.root.id, t])));
  const ids = (resolved: boolean) => props.threads().filter((t) => !!t.root.resolved === resolved).map((t) => t.root.id);
  const open = createMemo(() => ids(false));
  const resolved = createMemo(() => ids(true));
  const row = (id: string) => <Show when={byId().get(id)}>{(t) => <ThreadCard thread={t} canWrite={props.canWrite} />}</Show>;
  return (
    <>
      <Show when={!open().length}>
        <p class="px-0.5 py-3 text-muted">
          Select text and click <b>Add a comment</b> to start a discussion.
        </p>
      </Show>
      <For each={open()}>{row}</For>
      <Show when={resolved().length}>
        <details class="flex flex-col gap-4">
          <summary class="cursor-pointer list-none px-0.5 py-1.5 text-muted">{resolved().length} resolved</summary>
          <For each={resolved()}>{row}</For>
        </details>
      </Show>
      <Show when={comments.error}>
        <p class="text-red" title={comments.error}>
          Some comments aren't on GitHub yet ({comments.error}). Kept in this browser; retrying.
        </p>
      </Show>
      {/* Figma 14:428 */}
      <p class="flex flex-col gap-2 py-1 text-muted">
        Agents read comments with
        <span class="[overflow-wrap:anywhere] text-code">git show origin/red-letter-comments:{comments.file}</span>
      </p>
    </>
  );
}

// Figma 15:440: avatar 24 + name / time, the body 12px below
const Message = (props: { c: Comment }) => (
  <div class="flex flex-col gap-3">
    <div class="flex items-center gap-2">
      <Avatar login={props.c.author} size={24} />
      <div class="flex flex-col">
        <span>{props.c.author}</span>
        <span class="text-muted">{comments.sending.includes(props.c.id) ? "sending…" : ago(props.c.createdAt)}</span>
      </div>
    </div>
    <div class="break-words whitespace-pre-wrap">
      <MentionText text={props.c.body} />
    </div>
  </div>
);

function ThreadCard(props: { thread: Accessor<Thread>; canWrite: boolean }) {
  const t = props.thread;
  const where = () => (t().range ? (t().moved ? "· text changed since" : "") : "· text was removed");
  const [replying, setReplying] = createSignal(false);
  let input!: HTMLInputElement;
  const mentions = createMentions(() => input, () => {});
  const reply = (e: Submit) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    input.value = "";
    setReplying(false);
    submitReply(t().root.id, body);
  };
  return (
    <div
      class={`${card} cursor-pointer gap-6 ${t().root.id === doc.activeThread ? "shadow-[0_0_0_2px_rgba(223,171,1,.55),var(--shadow)]" : ""}`}
      onClick={(e) => {
        if (!(e.target instanceof Element && e.target.closest("form, button"))) selectThread(t());
      }}
    >
      <div>
        <button type="button" class={`${quote} cursor-pointer`} title="Go to the text" onClick={() => selectThread(t())}>
          {(t().root.quote ?? "").slice(0, 120)}
        </button>
        <Show when={where()}>
          <span class="mt-0.5 block text-muted">{where()}</span>
        </Show>
      </div>
      <Message c={t().root} />
      <For each={t().replies}>{(c) => <Message c={c} />}</For>
      <Show when={props.canWrite}>
        {/* Figma 22:561: pushing Reply shows the reply box with Comment (= send) and Cancel */}
        <Show
          when={replying()}
          fallback={
            <div class="flex items-center gap-3">
              <button type="button" class={btn} onClick={() => setReplying(true)}>
                Reply
              </button>
              <button type="button" class={btn} onClick={() => toggleResolved(t().root)}>
                {t().root.resolved ? "Reopen" : "Resolve"}
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
