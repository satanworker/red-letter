// Screens. Which one shows is repoStore's `screen`; the editor screen lives in doc/EditorScreen.tsx.
import { Match, Show, Switch } from "solid-js";
import { EditorScreen } from "./doc/EditorScreen.tsx";
import { APP_SLUG, authKind, rememberReturn, signIn, signOut, type AuthKind } from "./github.ts";
import { navigateTo, openRoute, repo } from "./repo/repoStore.ts";
import { Avatar, GithubMark, Logo } from "./ui.tsx";

export const App = () => (
  <Switch>
    <Match when={repo.screen === "loading"}>
      <div class="loading">
        <div class="spinner" />
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
      <div class="screen">
        <div class="card-lg">
          <h1>Something went wrong</h1>
          <p class="err">{repo.message}</p>
          <p>
            <a href="/">Back home</a>
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
    <button class="btn primary big" onClick={signInWith("oauth")}>
      <GithubMark /> Continue with GitHub
    </button>
    <p class="fine">
      One click, works on every repo you can already access. Prefer to pick repositories?{" "}
      <a href="#" onClick={signInWith("app")}>
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
    <div class="screen">
      <nav class="topnav">
        <Logo />
        <span class="spacer" />
        <Show when={repo.user}>
          {(u) => (
            <>
              <Avatar login={u().login} size={24} />{" "}
              <a href="#" class="muted" onClick={out}>
                Sign out
              </a>
            </>
          )}
        </Show>
      </nav>
      <div class="hero">
        <h1>
          Write together.
          <br />
          <span class="red">Agents included.</span>
        </h1>
        <p class="lede">
          Open any markdown file from GitHub, edit it live with your team, and leave comments in the margin. Your agents keep using <code>git push</code>; their
          changes show up here, ready to review.
        </p>
        <form class="open" onSubmit={open}>
          <input name="u" placeholder="Paste a GitHub file link: github.com/owner/repo/blob/main/README.md" autofocus />
          <button class="btn primary">Open</button>
        </form>
        <p class="fine">
          Or swap <code>github.com</code> for <code>{location.host}</code> in any file URL.
        </p>
        <Show when={!repo.user}>
          <div class="signin">
            <SignInButtons />
          </div>
        </Show>
      </div>
    </div>
  );
}

const SignIn = () => (
  <div class="screen">
    <nav class="topnav">
      <Logo />
    </nav>
    <div class="card-lg">
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
    <div class="screen">
      <nav class="topnav">
        <Logo />
      </nav>
      <div class="card-lg">
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
                <a href="https://github.com/settings/connections/applications/Ov23liCuqRqQVEAWuFcA" target="_blank">
                  Red Letter's GitHub settings
                </a>{" "}
                and click <b>Request</b> (or <b>Grant</b> if you're an owner) next to <b>{repo.owner}</b>, then reload. Or{" "}
                <a href="#" onClick={signInWith("app")}>
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
            <button class="btn primary" onClick={install}>
              Install on {repo.owner}
            </button>
          </p>
          <p class="fine">
            Don't own it? Ask the owner, or{" "}
            <a href="#" onClick={signInWith("oauth")}>
              continue with plain GitHub sign-in
            </a>{" "}
            instead.
          </p>
        </Show>
      </div>
    </div>
  );
}
