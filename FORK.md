# This fork

A personal fork of [T3 Code](https://github.com/pingdotgg/t3code) with a few extra features. The one rule: **official updates must stay easy to take.** Custom work goes in new files wherever possible. Where it has to touch an official file, keep the change to a few lines.

## Branches and remotes

|            |                                                             |
| ---------- | ----------------------------------------------------------- |
| `upstream` | pingdotgg/t3code, the official repo. Never push here.       |
| `origin`   | mooumari/t3code-m, this fork.                               |
| `my-t3`    | The branch in use: official code plus every custom feature. |
| `custom/*` | One branch per feature, merged into `my-t3` with `--no-ff`. |

## Taking official updates

```bash
git checkout my-t3
git fetch upstream && git merge upstream/main
vp i                                # the lockfile often changes
git push origin my-t3
```

- **`apps/web/src/routeTree.gen.ts` conflicts:** don't fix it by hand. Take either side, then start the web dev server once and it regenerates.
- **Any other conflict** will be in one of the official files listed below. Keep both sides. Lines marked `// fork:` are ours.
- **Before pushing,** typecheck the packages you touched (`npx tsc --noEmit -p .` in each) and run the fork's tests (see below).

## Adding a feature

1. `git checkout -b custom/<name> my-t3`
2. Put the code in new files. In official files, add only small hook-in lines, marked `// fork: <feature>`.
3. Don't thread new props through big official components like `ChatView`. Use a self-contained hook in your own file instead (see `useGitPanelLauncher`).
4. Merge into `my-t3` with `git merge --no-ff custom/<name>`, then push both branches.

## What the fork adds

**Translate button on assistant messages.** It uses the model under Settings → Text generation, and has:

- a one-click default language,
- styles (custom instructions such as "explain like I'm 5"),
- results saved in localStorage, so reopening doesn't translate again.

Code: `apps/web/src/components/chat/MessageTranslation.tsx`, `messageTranslations.ts`, and `apps/server/src/translation/`.

**Git page** (`/git`, route in `apps/web/src/routes/_chat.git.tsx`). It works like VS Code's Source Control:

- changes,
- a commit graph with lanes, branch labels and push/pull arrows,
- commit details and diffs,
- a branch and worktree picker,
- a list of worktrees with the T3 threads working in each,
- branch review (a branch compared with `main`: its commits, files and diffs),
- a commit box (an empty message is written by AI) and Sync.

**Git tab in every thread** (right panel, shortcut `G`). The same view, scoped to the thread's worktree:

- only Changes and Graph, with a draggable split,
- commits expand in place,
- the full commit message on hover.

Git code:

- Web: `apps/web/src/components/gitDashboard/`. `GitDashboardView.tsx` is the entry point, and its `compact` prop gives the thread-tab layout.
- Server: `apps/server/src/gitDashboard/`. It is read-only git. Commit and Sync reuse T3's existing `git.runStackedAction` and `vcs.pull`.
- Contracts: `packages/contracts/src/gitDashboard.ts`.

## Official files the fork changes

These are the only places an update can conflict:

- `packages/contracts/src/rpc.ts`, `index.ts`: RPC entries for translate and Git.
- `packages/client-runtime/package.json`: exports for the new client state files.
- `apps/server/src/ws.ts`, `auth/RpcAuthorization.ts`: the matching handlers. `server.ts`: registers the Git service.
- `apps/server/src/textGeneration/*`: a translate method in each provider.
- `apps/web/src/rightPanelStore.ts`, `components/RightPanelTabs.tsx`, `components/ChatView.tsx`: the Git tab (`// fork: Git tab`).
- `apps/web/src/components/chat/MessagesTimeline.tsx`: the translate button.
- `apps/web/src/components/sidebar/SidebarChrome.tsx`: the Git page link.

## Testing

- Web tests: `cd apps/web && ../../node_modules/.bin/vp test run src/components/gitDashboard src/components/chat/messageTranslations.test.ts`
- Server tests: `cd apps/server && ../../node_modules/.bin/vp test run src/gitDashboard`
- **Dev server:** use a copy of your data, never the real `~/.t3/userdata` (see AGENTS.md → Test data). Run `node scripts/dev-runner.ts dev --home-dir "$PWD/.t3"`.
  - Stop it by killing the whole process tree started from the PID you captured. Killing the runner alone leaves vite and the server running.
- **The Git tab works on real project folders.** Committing or syncing from a test server makes real commits and pushes.

## Ideas not done yet

- Choose which files to commit. Needs a server change, because the commit action currently stages everything.
- A lighter AI commit-message input: a smaller diff cutoff, and skipping lockfiles and generated files.
- Mobile versions of Translate and Git.
