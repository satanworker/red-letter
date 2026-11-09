// GitHub's rate limit, as the last response reported it (every REST and GraphQL response carries x-ratelimit-*
// headers, 304s included). Polling reads it: low → slower, exhausted → stopped until the reset. Writes the user asked
// for (saves, comments) are never held back here; GitHub's own refusal is reported where they happen.
import { createStore } from "solid-js/store";

type Bucket = { remaining: number; limit: number; reset: number }; // reset: epoch ms
const [state, set] = createStore({
  core: null as Bucket | null,
  graphql: null as Bucket | null,
  blockedUntil: 0, // epoch ms while GitHub refuses us (primary limit hit, or a secondary "retry later")
});
export const rate = state;

export function noteResponse(res: Response) {
  const remaining = res.headers.get("x-ratelimit-remaining");
  const reset = res.headers.get("x-ratelimit-reset");
  if (remaining !== null && reset !== null) {
    const bucket: Bucket = { remaining: Number(remaining), limit: Number(res.headers.get("x-ratelimit-limit") ?? 0), reset: Number(reset) * 1000 };
    set(res.headers.get("x-ratelimit-resource") === "graphql" ? "graphql" : "core", bucket);
    if (bucket.remaining === 0 && (res.status === 403 || res.status === 429)) block(bucket.reset);
  }
  const retry = res.headers.get("retry-after"); // secondary limit: seconds to wait
  if (retry && (res.status === 403 || res.status === 429)) block(Date.now() + Number(retry) * 1000);
}

// GraphQL says "rate limit exceeded" in the body with a 200: the reset is in the headers all the same.
export const noteGraphqlLimited = (res: Response) => block(Number(res.headers.get("x-ratelimit-reset") ?? Date.now() / 1000 + 60) * 1000);

let clear: number | undefined;
function block(until: number) {
  if (until <= state.blockedUntil) return;
  set("blockedUntil", until);
  clearTimeout(clear);
  clear = window.setTimeout(() => set("blockedUntil", 0), Math.max(0, until - Date.now()) + 1000);
}

export const blocked = () => state.blockedUntil > Date.now();
// Under a fifth of either bucket left: polls slow down (docStore.tick)
export const low = () => [state.core, state.graphql].some((b) => b && b.limit > 0 && b.remaining / b.limit < 0.2);
export const resetTime = () => new Date(state.blockedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
