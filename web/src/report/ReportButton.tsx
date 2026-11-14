// The floating "Report a problem" button, bottom right on every screen (rendered apart from the app by main.tsx, so it
// still works when the app is stuck or crashed). Errors and freezes since the last report show as a red count on it.
// Its panel: what happened (optional), what gets sent, Send (to the hub) and Download (the same JSON, when sending
// fails or there's no sign-in). ⌘/Ctrl+Enter sends; Esc and a click outside close it (native popover).
import { Show, createSignal } from "solid-js";
import { linkBtn, primaryBtn } from "../ui.tsx";
import { contents, downloadReport, report, resetReport, sendReport } from "./report.ts";

export function ReportButton() {
  let pop!: HTMLDivElement;
  let box!: HTMLTextAreaElement;
  const [note, setNote] = createSignal("");
  const [sends, setSends] = createSignal("");
  const toggled = (e: ToggleEvent) => {
    if (e.newState !== "open") return;
    if (report.sent) {
      resetReport();
      setNote("");
    }
    setSends(contents());
    box.focus();
  };
  const send = async () => {
    if (await sendReport(note().trim())) setNote("");
  };
  return (
    <>
      <button
        class={`fixed right-3 bottom-9 z-50 grid size-7 cursor-pointer place-items-center rounded-full border-[.5px] bg-card text-muted shadow-figma hover:text-fg ${report.problems ? "border-red text-red" : "border-line"}`}
        title={report.problems ? `${report.problems} problem${report.problems === 1 ? "" : "s"} noticed: report it` : "Report a problem"}
        aria-label="Report a problem"
        popoverTarget="report"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M8 2l1.9 1.9M16 2l-1.9 1.9M9 7.1V6a3 3 0 0 1 6 0v1.1M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6zM12 20v-9M6.5 13H3M21 13h-3.5M6 9 3.8 7M18 9l2.2-2M6 17l-2.6 2M18 17l2.6 2" />
        </svg>
        <Show when={report.problems}>
          <span class="absolute -top-1.5 -right-1.5 min-w-4 rounded-full bg-red px-1 text-center text-[10px] leading-4 text-white">{report.problems}</span>
        </Show>
      </button>
      <div
        ref={pop}
        id="report"
        popover
        class="fixed inset-auto right-3 bottom-18 m-0 w-80 flex-col gap-3 rounded-xl bg-card px-5 py-5 text-fg shadow-[0_4px_17.8px_rgba(0,0,0,.1),var(--shadow)] [&:popover-open]:flex"
        onToggle={toggled}
      >
        <Show
          when={!report.sent}
          fallback={
            <>
              <p class="font-medium">Thanks, it's sent.</p>
              <p class="text-muted">
                Report <code class="select-all">{report.sent}</code>. Quote it if you write to us about this.
              </p>
              <div>
                <button class={`${primaryBtn} h-7`} onClick={() => pop.hidePopover()}>
                  Close
                </button>
              </div>
            </>
          }
        >
          <p class="font-medium">Report a problem</p>
          <p class="text-muted">Slow, stuck or broken? Say what you were doing; the logs come with it.</p>
          <textarea
            ref={box}
            rows={4}
            aria-label="What happened"
            placeholder="What happened? (optional)"
            class="w-full rounded-lg border-[.4px] border-line bg-card px-3 py-2 outline-none placeholder:text-muted"
            value={note()}
            onInput={(e) => setNote(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && void send()}
          />
          <p class="text-[11px] leading-4 text-muted">Sends {sends()}, this page's address and your browser. GitHub tokens are never included.</p>
          <Show when={report.error}>
            <p class="text-red [overflow-wrap:anywhere]">{report.error}</p>
          </Show>
          <div class="flex items-center gap-3">
            <button class={`${primaryBtn} h-7 disabled:cursor-default disabled:opacity-50`} disabled={report.sending} onClick={() => void send()}>
              {report.sending ? "Sending…" : "Send report"}
            </button>
            <button class={linkBtn} title="Save the same report as a file" onClick={() => void downloadReport(note().trim())}>
              Download
            </button>
          </div>
        </Show>
      </div>
    </>
  );
}
