// Comment threads beside the doc. Rows are keyed by thread id, so a reply being typed survives updates.
import { For, Show, createMemo, createSignal, onMount, type Accessor } from "solid-js";
import { cancelComment, doc, selectThread, submitComment, submitReply, toggleResolved } from "../doc/docStore.ts";
import { Avatar, ago } from "../ui.tsx";
import type { Thread } from "./commentsSelectors.ts";
import type { Comment } from "./commentsService.ts";
import { comments } from "./commentsStore.ts";

type Submit = SubmitEvent & { currentTarget: HTMLFormElement };

export function CommentsPanel(props: { canWrite: boolean; threads: Accessor<Thread[]> }) {
  const byId = createMemo(() => new Map(props.threads().map((t) => [t.root.id, t])));
  const ids = (resolved: boolean) => props.threads().filter((t) => !!t.root.resolved === resolved).map((t) => t.root.id);
  const open = createMemo(() => ids(false));
  const resolved = createMemo(() => ids(true));
  const row = (id: string) => <Show when={byId().get(id)}>{(t) => <ThreadCard thread={t} canWrite={props.canWrite} />}</Show>;
  return (
    <>
      <Show when={doc.composing} keyed>
        {(c) => <Compose quote={c.quote} />}
      </Show>
      <Show when={!open().length && !doc.composing}>
        <p class="empty">
          Select text and click <b>Comment</b> to start a discussion.
        </p>
      </Show>
      <For each={open()}>{row}</For>
      <Show when={resolved().length}>
        <details class="resolved">
          <summary>{resolved().length} resolved</summary>
          <For each={resolved()}>{row}</For>
        </details>
      </Show>
      <Show when={comments.error}>
        <p class="fine err" title={comments.error}>
          Some comments aren't on GitHub yet ({comments.error}). Kept in this browser; retrying.
        </p>
      </Show>
      <p class="fine">
        Agents read comments with
        <br />
        <code>git show origin/red-letter-comments:{comments.file}</code>
      </p>
    </>
  );
}

function Compose(props: { quote: string }) {
  let input!: HTMLTextAreaElement;
  onMount(() => input.focus());
  const submit = (e: Submit) => {
    e.preventDefault();
    const body = input.value.trim();
    if (body) submitComment(body);
  };
  return (
    <form class="card compose" onSubmit={submit}>
      <q>{props.quote.slice(0, 200)}</q>
      <div class="who">
        <Avatar login={doc.login} size={24} />
        <textarea
          ref={input}
          placeholder="Add a comment…"
          rows="2"
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }}
        />
      </div>
      <div class="actions">
        <button type="button" class="link" onClick={cancelComment}>
          Cancel
        </button>
        <button class="btn">Comment</button>
      </div>
    </form>
  );
}

const Message = (props: { c: Comment }) => (
  <div class="c">
    <div class="who">
      <Avatar login={props.c.author} size={24} />
      <div class="name">
        <span>{props.c.author}</span>
        <span class="meta">{comments.sending.includes(props.c.id) ? "sending…" : ago(props.c.createdAt)}</span>
      </div>
    </div>
    <div class="body">{props.c.body}</div>
  </div>
);

function ThreadCard(props: { thread: Accessor<Thread>; canWrite: boolean }) {
  const t = props.thread;
  const where = () => (t().range ? (t().moved ? "· text changed since" : "") : "· text was removed");
  const [replying, setReplying] = createSignal(false);
  let input!: HTMLInputElement;
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
      class="card thread"
      classList={{ active: t().root.id === doc.activeThread }}
      onClick={(e) => {
        if (!(e.target instanceof Element && e.target.closest("form, button"))) selectThread(t());
      }}
    >
      <div class="quote">
        <q>{(t().root.quote ?? "").slice(0, 120)}</q>
        <Show when={where()}>
          <span class="meta">{where()}</span>
        </Show>
      </div>
      <Message c={t().root} />
      <For each={t().replies}>{(c) => <Message c={c} />}</For>
      <Show when={props.canWrite}>
        <Show when={replying()}>
          <form class="reply" onSubmit={reply}>
            <input
              ref={(el) => ((input = el), requestAnimationFrame(() => el.focus()))}
              placeholder="Reply…"
              onKeyDown={(e) => e.key === "Escape" && setReplying(false)}
            />
          </form>
        </Show>
        <div class="actions">
          <button type="button" class="btn" onClick={() => (replying() ? input.form?.requestSubmit() : setReplying(true))}>
            Reply
          </button>
          <button type="button" class="btn" onClick={() => toggleResolved(t().root)}>
            {t().root.resolved ? "Reopen" : "Resolve"}
          </button>
        </div>
      </Show>
    </div>
  );
}
