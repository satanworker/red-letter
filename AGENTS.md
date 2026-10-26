# Red Letter: notes for agents

Read `docs/DESIGN.md` (truth model, replay, prototype status) before changing behaviour. When a feature lands, update its "Prototype status" and add a line to `CHANGELOG.md` (newest day first).

## web/ architecture

Data flow: `external event -> store action -> service call -> store update -> selector -> component render`.

- **Feature folders, not layer folders:** `repo/`, `doc/`, `comments/`, `palette/` (⌘K). Shared GitHub and IndexedDB access is in `src/github.ts` and `src/idb.ts`.
- **Styling is Tailwind v4.** Utilities in the components; tokens (Figma "Red Letter" colours, shadow, font) are CSS variables in `src/app.css`, shared with CodeMirror's themes. Don't combine class strings that set the same property (Tailwind's output order decides, not the class order). Check layout against Figma on `/__figma` (README).
- **Services are dumb.** `repoService.ts`, `commentsService.ts` and `github.ts` fetch, validate and map. They hold no app state and never import a store.
- **Stores own state and orchestration.** `repoStore.ts` (screen, repo, branch, files, routing), `docStore.ts` (open Session, status, panel/tab/draft comment) and `commentsStore.ts`. Loading, errors and "what happens when X" live in store actions.
- **Selectors are pure.** `*Selectors.ts` derive render data. Memoize them in components with `createMemo`; don't store derived data.
- **Components render and call actions.** No business logic or fetching in components. Global listeners (navigation, focus, beforeunload, ⌘K) live in `main.tsx` and only call store actions.
- `doc/session.ts`, `replay.ts`, `regions.ts` and `hub.ts` are the engine (CRDT ↔ git). Keep UI out of them.

## Solid

- Never destructure props or store objects: `props.x` / `doc.status.saving`, read inside JSX or a memo. Destructuring freezes the value.
- Lists whose rows hold input state (reply boxes) are keyed by id strings (`For each={ids()}`), not by objects that selectors recreate.
- `set("obj", {...})` on a store merges into the object it holds: include every key you mean to reset.
- CodeMirror owns its DOM: mount it in `onMount`, destroy it in `onCleanup`.

## Verify

```sh
cd web && bunx tsc -p . && bunx tsc -p tsconfig.sw.json && bun build.ts
cd server && CGO_ENABLED=0 go test ./...
```

Smoke in a browser with `cd web && bun dev.ts` (localhost:5173, hub on localhost:8787). `window.rl` exposes `{ doc, repo, comments }`; `rl.doc.session` is the open Session. Test edits go to the `demo` branch (`/satanworker/red-letter/blob/demo/demo.md`); leave `demo.md` as you found it.
