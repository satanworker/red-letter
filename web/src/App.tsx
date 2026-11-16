// Screens. Which one shows is repoStore's `screen`; the editor screen lives in doc/EditorScreen.tsx.
import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js";
import { EditorScreen } from "./doc/EditorScreen.tsx";
import { APP_SLUG, authKind, rememberReturn, signIn, signOut, type AuthKind } from "./github.ts";
import { selectHomeRepos } from "./repo/repoSelectors.ts";
import type { UserRepo } from "./repo/repoService.ts";
import { navigateTo, openRoute, repo } from "./repo/repoStore.ts";
import { Avatar, GithubMark, Logo, Spinner, ago, badge, fine, listKeys, primaryBtn } from "./ui.tsx";

const screen = "min-h-screen";
const topnav = "flex h-[52px] items-center gap-2.5 px-5";
const cardLg = "mx-auto mt-[14vh] max-w-[460px] rounded-[10px] p-8 shadow-pop [&_h1]:mb-2 [&_h1]:text-[24px] [&_h1]:font-bold [&_p]:my-3 [&_p]:text-muted";
const link = "underline";

export const App = () => (
  <Switch>
    <Match when={repo.screen === "loading"}>
      <div class="flex h-screen items-center justify-center gap-2.5 text-muted">
        <Spinner />
        {repo.message}
      </div>
    </Match>
    <Match when={repo.screen === "landing"}>
      <Landing />
    </Match>
    <Match when={repo.screen === "signin"}>
      <SignIn />
    </Match>
    <Match when={repo.screen === "noaccess"}>
      <NoAccess />
    </Match>
    <Match when={repo.screen === "error"}>
      <div class={screen}>
        <div class={cardLg}>
          <h1>Something went wrong</h1>
          <p class="text-red!">{repo.message}</p>
          <p>
            <a class={link} href="/">
              Back home
            </a>
          </p>
        </div>
      </div>
    </Match>
    <Match when={repo.screen === "workspace"}>
      <EditorScreen />
    </Match>
  </Switch>
);

const signInWith = (kind: AuthKind) => (e: MouseEvent) => {
  e.preventDefault();
  void signIn(kind);
};

const SignInButtons = () => (
  <>
    <button class={`${primaryBtn} h-10 text-[14px]`} onClick={signInWith("oauth")}>
      <GithubMark /> Continue with GitHub
    </button>
    <p class={fine}>
      One click, works on every repo you can already access. Prefer to pick repositories?{" "}
      <a class={link} href="#" onClick={signInWith("app")}>
        Use the GitHub App instead
      </a>
      .
    </p>
  </>
);

function Landing() {
  const open = (e: SubmitEvent & { currentTarget: HTMLFormElement }) => {
    e.preventDefault();
    const u = new FormData(e.currentTarget).get("u")?.toString().trim() ?? "";
    const path = u.replace(/^(https?:\/\/)?(www\.)?github\.com/, "").replace(/^https?:\/\/[^/]+/, "");
    navigateTo(path.startsWith("/") ? path : `/${path}`);
  };
  const out = (e: MouseEvent) => {
    e.preventDefault();
    signOut();
    void openRoute(new URL(location.href));
  };
  return (
    <div class={screen}>
      <nav class={topnav}>
        <Logo />
        <span class="flex-1" />
        <Show when={repo.user}>
          {(u) => (
            <>
              <Avatar login={u().login} size={24} />
              <a href="#" class="text-muted hover:text-fg" onClick={out}>
                Sign out
              </a>
            </>
          )}
        </Show>
      </nav>
      <main class="mx-auto mt-[12vh] max-w-[720px] px-6">
        <h1 class="mb-[18px] text-[48px] leading-[1.1] font-bold tracking-[-.025em]">
          Write together.
          <br />
          <span class="text-red">Agents included.</span>
        </h1>
        <p class="mb-8 text-[18px] leading-[1.6] text-muted">
          Open any markdown file from GitHub, edit it live with your team, and leave comments in the margin. Your agents keep using <code>git push</code>; their
          changes show up here, live, each commit one click from its diff.
        </p>
        <form class="flex gap-2" onSubmit={open}>
          <input
            name="u"
            aria-label="GitHub file link"
            placeholder="Paste a GitHub file link: github.com/owner/repo/blob/main/README.md"
            autofocus
            class="h-10 flex-1 rounded-md border border-line bg-bg2 px-3 text-[15px] outline-none focus:border-transparent focus:bg-bg focus:shadow-[0_0_0_2px_rgba(35,131,226,.35)]"
          />
          <button class={`${primaryBtn} h-10`}>Open</button>
        </form>
        <p class={fine}>
          Or swap <code>github.com</code> for <code>{location.host}</code> in any file URL.
        </p>
        <Show when={!repo.user}>
          <div class="mt-10 border-t border-line pt-7">
            <SignInButtons />
          </div>
        </Show>
        <Show when={repo.user}>
          <Repos />
        </Show>
      </main>
    </div>
  );
}

// Signed in: the repos opened in this browser, then a few others the user can reach, with a search over all of them;
// a click opens its README.
function Repos() {
  const [query, setQuery] = createSignal("");
  const lists = createMemo(() => selectHomeRepos(repo.recent, repo.repos, query()));
  const heading = "mt-8 mb-2 px-3 text-[12px] font-medium tracking-wide text-faint uppercase";
  const rows = (list: UserRepo[]) => (
    <ul>
      <For each={list}>
        {(r) => (
          <li>
            <a href={`/${r.full_name}`} class="flex items-center gap-2 rounded-md px-3 py-1.5 hover:bg-hover focus:bg-hover">
              <Avatar login={r.full_name.split("/")[0]} size={16} />
              <span class="shrink-0 font-medium">{r.full_name}</span>
              <Show when={r.private}>
                <span class={`${badge} px-1.5 text-[11px]`}>private</span>
              </Show>
              <span class="min-w-0 flex-1 truncate text-muted">{r.description}</span>
              <Show when={r.pushed_at}>
                <span class="shrink-0 text-faint">{ago(r.pushed_at)}</span>
              </Show>
            </a>
          </li>
        )}
      </For>
    </ul>
  );
  return (
    <div class="mt-4 mb-16 -mx-3" onKeyDown={(e) => listKeys(e, "li > a")}>
      <Show when={repo.recent.length || repo.repos.length}>
        <input
          type="search"
          aria-label="Search your repositories"
          placeholder="Search your repositories"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          class="mx-3 mt-6 h-8 w-[calc(100%-1.5rem)] rounded-md border border-line bg-bg2 px-3 outline-none focus:border-transparent focus:bg-bg focus:shadow-[0_0_0_2px_rgba(35,131,226,.35)]"
        />
      </Show>
      <Show when={lists().opened.length}>
        <h2 class={heading}>Recent</h2>
        {rows(lists().opened)}
      </Show>
      <Show when={lists().others.length}>
        <h2 class={heading}>{query().trim() ? "Your repositories" : "Recently pushed"}</h2>
        {rows(lists().others)}
      </Show>
      <Show when={query().trim() && !lists().opened.length && !lists().others.length}>
        <p class="px-3 py-2 text-muted">No repository matches “{query().trim()}”.</p>
      </Show>
    </div>
  );
}

const SignIn = () => (
  <div class={screen}>
    <nav class={topnav}>
      <Logo />
    </nav>
    <div class={cardLg}>
      <h1>Sign in</h1>
      <p>
        Sign in to open <b>{repo.message}</b>
        <Show when={repo.message !== repo.name}>
          {" "}
          from {repo.owner}/{repo.name}
        </Show>
        .
      </p>
      <SignInButtons />
    </div>
  </div>
);

function NoAccess() {
  const install = () => {
    rememberReturn();
    location.assign(`https://github.com/apps/${APP_SLUG}/installations/new`);
  };
  return (
    <div class={screen}>
      <nav class={topnav}>
        <Logo />
      </nav>
      <div class={cardLg}>
        <Show
          when={authKind() === "app"}
          fallback={
            <>
              <h1>No access to this repo</h1>
              <p>
                Your GitHub account can't see{" "}
                <b>
                  {repo.owner}/{repo.name}
                </b>{" "}
                through Red Letter.
              </p>
              <p>
                If it belongs to an organization, Red Letter needs that org's approval: open{" "}
                <a class={link} href="https://github.com/settings/connections/applications/Ov23liCuqRqQVEAWuFcA" target="_blank">
                  Red Letter's GitHub settings
                </a>{" "}
                and click <b>Request</b> (or <b>Grant</b> if you're an owner) next to <b>{repo.owner}</b>, then reload. Or{" "}
                <a class={link} href="#" onClick={signInWith("app")}>
                  use the GitHub App
                </a>
                .
              </p>
            </>
          }
        >
          <h1>Install Red Letter on this repo</h1>
          <p>
            You signed in with the GitHub App, which only reaches repositories it's installed on.{" "}
            <b>
              {repo.owner}/{repo.name}
            </b>{" "}
            isn't one of them yet.
          </p>
          <p>
            <button class={`${primaryBtn} h-7`} onClick={install}>
              Install on {repo.owner}
            </button>
          </p>
          <p class={fine}>
            Don't own it? Ask the owner, or{" "}
            <a class={link} href="#" onClick={signInWith("oauth")}>
              continue with plain GitHub sign-in
            </a>{" "}
            instead.
          </p>
        </Show>
      </div>
    </div>
  );
}
