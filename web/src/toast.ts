// Toasts: errors and notices that would otherwise be an alert(), a red line somewhere, or nothing at all. Stores
// call toast(); Toasts.tsx shows them in the window's bottom-left corner. An error stays until closed (it may carry
// text to copy, a comment that wasn't sent); a notice goes by itself. The same text twice in a row shows once.
import { createStore } from "solid-js/store";

export type Toast = { id: number; text: string; kind: "error" | "info"; copy?: string };
const [state, set] = createStore({ list: [] as Toast[] });
export const toasts = state;
let next = 0;

export function toast(text: string, kind: Toast["kind"] = "error", copy?: string): number {
  const same = state.list.find((t) => t.text === text);
  if (same) return same.id;
  const id = ++next;
  set("list", (l) => [...l.slice(-3), { id, text, kind, copy }]); // four at most: the oldest goes
  if (kind === "info") setTimeout(() => dismiss(id), 5000);
  return id;
}

export const dismiss = (id: number) => set("list", (l) => l.filter((t) => t.id !== id));
// "Something failed: <why>" from whatever was thrown
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
