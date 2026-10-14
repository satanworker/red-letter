// GitHub sign-in (tokens live only in this browser) and thin REST/GraphQL helpers. Two ways in:
// - "app":   GitHub App user token: access = repos where the App is installed ∩ the user's access.
// - "oauth": classic OAuth App with `repo` scope: every repo the user can reach, nothing to install.
import { idbClear, idbGet, idbPut } from "./idb.ts";

export const APP_SLUG = "red-letter-diff";
const CLIENT_IDS = { app: "Iv23liTw70O2dgREat8o", oauth: "Ov23liCuqRqQVEAWuFcA" };
export type AuthKind = keyof typeof CLIENT_IDS;
export const HUB = location.hostname === "localhost" ? "http://localhost:8787" : "https://diff-api.satanworker.com";
const API = "https://api.github.com";

type Auth = { kind: AuthKind; access_token: string; expires_at: number; refresh_token?: string };
const AUTH_KEY = "rl_auth";
const RETURN_KEY = "rl_return";

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function rememberReturn(path = location.pathname + location.search) {
  sessionStorage.setItem(RETURN_KEY, path);
}

export async function signIn(kind: AuthKind = "oauth") {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem("rl_pkce", JSON.stringify({ state, verifier, kind }));
  rememberReturn();
  const q = new URLSearchParams({
    client_id: CLIENT_IDS[kind],
    redirect_uri: `${location.origin}/auth/callback`,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...(kind === "oauth" ? { scope: "repo" } : {}),
  });
  location.assign(`https://github.com/login/oauth/authorize?${q}`);
}

// Also drops this browser's copies of docs and GitHub responses: the next person on this browser must not see them.
export function signOut() {
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem("rl_user");
  void idbClear("docs");
  void idbClear("http");
}

// Tokens saved before `kind` existed all came from the GitHub App.
export const authKind = (): AuthKind | null => {
  const auth: Auth | null = JSON.parse(localStorage.getItem(AUTH_KEY) ?? "null");
  return auth ? (auth.kind ?? "app") : null;
};

async function exchange(kind: AuthKind, route: "token" | "refresh", body: Record<string, string>): Promise<Auth> {
  const res = await fetch(`${HUB}/oauth/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, client: kind }),
  });
  // GitHub's token endpoint shape (passed through verbatim by the hub)
  const j: { access_token?: string; expires_in?: number; refresh_token?: string; error_description?: string; error?: string } = await res.json();
  if (!j.access_token) throw new Error(j.error_description ?? j.error ?? `token exchange failed (${res.status})`);
  // Tokens without expiry are treated as valid for a year.
  const auth: Auth = { kind, access_token: j.access_token, expires_at: Date.now() + (j.expires_in ?? 365 * 86400) * 1000, refresh_token: j.refresh_token };
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  localStorage.removeItem("rl_user");
  return auth;
}

// /auth/callback: the sign-in redirect (state + PKCE) and the GitHub App install redirect (no state) land here.
export async function completeSignIn(): Promise<string> {
  const q = new URLSearchParams(location.search);
  const code = q.get("code");
  if (!code) throw new Error(q.get("error_description") ?? "missing code");
  const pkce: { state: string; verifier: string; kind: AuthKind } | null = JSON.parse(sessionStorage.getItem("rl_pkce") ?? "null");
  sessionStorage.removeItem("rl_pkce");
  const body: Record<string, string> = { code, redirect_uri: `${location.origin}/auth/callback` };
  let kind: AuthKind = "app"; // the install redirect only comes from the GitHub App
  if (q.get("state")) {
    if (!pkce || pkce.state !== q.get("state")) throw new Error("sign-in state mismatch; try again");
    body.code_verifier = pkce.verifier;
    kind = pkce.kind ?? "app";
  }
  await exchange(kind, "token", body);
  const back = sessionStorage.getItem(RETURN_KEY) ?? "/";
  sessionStorage.removeItem(RETURN_KEY);
  return back.startsWith("/auth/") ? "/" : back;
}

let refreshing: Promise<Auth | null> | undefined;
export async function token(): Promise<string | null> {
  const auth: Auth | null = JSON.parse(localStorage.getItem(AUTH_KEY) ?? "null");
  if (!auth) return null;
  if (auth.expires_at - Date.now() > 5 * 60_000) return auth.access_token;
  if (!auth.refresh_token) return null;
  refreshing ??= exchange(auth.kind ?? "app", "refresh", { refresh_token: auth.refresh_token })
    .catch((e) => {
      // offline: keep the expired token; requests fail and fall back to this browser's copies
      if (e instanceof TypeError) return auth;
      localStorage.removeItem(AUTH_KEY);
      localStorage.removeItem("rl_user");
      return null;
    })
    .finally(() => (refreshing = undefined));
  return (await refreshing)?.access_token ?? null;
}

export async function gh(path: string, init: RequestInit & { raw?: boolean } = {}): Promise<Response> {
  const t = await token();
  return fetch(path.startsWith("https://") ? path : API + path, {
    ...init,
    cache: "no-store", // API refs carry max-age=60; the browser cache would serve stale heads
    headers: {
      ...(t ? { authorization: `Bearer ${t}` } : {}),
      accept: init.raw ? "application/vnd.github.raw" : "application/vnd.github+json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function ghJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await gh(path, init);
  if (!res.ok) throw new HttpError(res.status, `${init?.method ?? "GET"} ${path} -> ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

// GET with a copy in IndexedDB. Sha-addressed URLs never change, so their copy is used without a request.
// Others revalidate with the ETag (a 304 doesn't count against the rate limit) and fall back to the copy offline.
export async function cachedGet(path: string, opts: { raw?: boolean; immutable?: boolean } = {}): Promise<string> {
  const key = `${opts.raw ? "raw " : ""}${path}`;
  const copy = await idbGet<{ etag: string; body: string }>("http", key);
  if (copy && opts.immutable) return copy.body;
  let res: Response;
  try {
    res = await gh(path, { raw: opts.raw, headers: copy?.etag ? { "if-none-match": copy.etag } : {} });
  } catch (e) {
    if (copy) return copy.body;
    throw e;
  }
  if (res.status === 304 && copy) return copy.body;
  if (!res.ok) throw new HttpError(res.status, `GET ${path} -> ${res.status} ${await res.text()}`);
  const body = await res.text();
  void idbPut("http", key, { etag: res.headers.get("etag") ?? "", body });
  return body;
}

export const post = <T>(path: string, body: unknown) => ghJson<T>(path, { method: "POST", body: JSON.stringify(body) });

// Atomic multi-ref compare-and-swap. REST PATCH has no CAS on non-branch refs. Any error = conflict.
export async function updateRefs(repositoryId: string, refUpdates: { name: string; beforeOid: string; afterOid: string; force?: boolean }[]) {
  const res = await gh(`${API}/graphql`, {
    method: "POST",
    body: JSON.stringify({
      query: "mutation($input: UpdateRefsInput!){ updateRefs(input:$input){ clientMutationId } }",
      variables: { input: { repositoryId, refUpdates } },
    }),
  });
  const body: { errors?: { message: string }[] } = await res.json();
  return res.ok && !body.errors ? null : (body.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`);
}

export type User = { login: string; avatar_url: string };
export async function currentUser(): Promise<User | null> {
  const cached: User | null = JSON.parse(localStorage.getItem("rl_user") ?? "null");
  if (cached) return cached;
  if (!(await token())) return null;
  const u = await ghJson<User>("/user");
  localStorage.setItem("rl_user", JSON.stringify({ login: u.login, avatar_url: u.avatar_url }));
  return u;
}

export const sha1 = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
export const b64 = (u: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
export const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/\n/g, "")), (c) => c.charCodeAt(0));
export const encPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");
