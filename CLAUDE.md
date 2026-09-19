# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

pergent is a personal agent runner. Each task is a prompt plus a small JSON config; running a task spawns headless `claude -p` and stores the result on disk. A small React UI lets you edit prompts, trigger runs, and read outputs. Everything is files, no database, no build step for the Node side.

Keep it minimal: no new runtime dependencies without a clear reason, one feature per step, verified with a real run.

## Commands

Requires Node >= 24 (TypeScript runs directly via type stripping, so `.ts` files are executed with plain `node` and imports use `.ts` extensions).

```sh
npm run task -- list            # list tasks in tasks/
npm run task -- run <name>      # run one task, print output.md and a status line; exit 1 on failure
npm run serve                   # API + static UI on http://localhost:4321 (serves dist/, so build first)
npm run dev                     # Vite dev server for web/, proxies /api to :4321 (run `npm run serve` alongside)
npm run build                   # vite build -> dist/
npm run typecheck               # tsc for src/ (root tsconfig) and web/ (web/tsconfig.json)
```

There are no tests and no linter. `npm run typecheck` is the only check.

## Architecture

Three layers, all small:

- `src/runner.ts` is the core. It loads a task from `tasks/<name>/`, creates `runs/<name>/<ISO timestamp>/`, optionally runs the task's `before` shell command in that directory, then spawns `claude -p --output-format stream-json --verbose --strict-mcp-config` with the prompt on stdin and the run directory as cwd. It parses the stream for the final `result` event and writes `meta.json`, `output.md`, `log.jsonl`, `stderr.log`.
- `src/server.ts` is a dependency-free `node:http` server: `/api/tasks`, `PUT /api/tasks/:name`, `/api/tasks/:name/runs[/:runId]`, `POST /api/tasks/:name/run` (202, or 409 if that task is already running). Everything else falls through to `dist/` with an `index.html` SPA fallback. Binds to 127.0.0.1 only.
- `web/` is a React 19 + Tailwind v4 PWA built by Vite (`root: "web"`, output `../dist`). `web/src/api.ts` is the typed client; its `TaskConfig`/`RunMeta` types are a hand-copied subset of the ones in `src/runner.ts`, so change both when adding fields. Markdown output is rendered with `marked`. Two views, switched by `web/src/router.tsx` (pushState, no dependency): `/` is the editor in `App.tsx`, and `/read/<task>[/<runId>]` is the reading view in `Read.tsx`, which shows the latest ok run at reading size with ←/→ between runs and renders bare source URLs as small host chips. The PWA `start_url` is `/read`.

`src/cli.ts` is a thin wrapper over the same runner used by the server.

### Deployment

Coolify deploys `compose.yaml` (one `app` service, port 4321 exposed, `runs` and `claude-home` named volumes) from the `Dockerfile` (multi-stage: vite build, then a slim node 24 image with `@anthropic-ai/claude-code` installed globally and `src/`, `scripts/`, `tasks/`, `dist/` copied; the runtime imports nothing from node_modules; runs as root so the volumes are always writable). Coolify's proxy does HTTPS. Variables, set in Coolify's UI: `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`; a container has no browser login), `BASIC_AUTH_USER`/`BASIC_AUTH_PASSWORD` (the server enforces basic auth on every request when both are set, nothing else protects the UI), `TZ`. The server binds `HOST` (default loopback; the image sets `0.0.0.0`) and answers `GET /healthz` without auth for the compose `healthcheck` (Coolify ignores its UI health page for compose apps and Traefik only routes to healthy containers; the check runs with `node -e fetch(...)` because the image has no curl). Tasks are baked into the image, so prompt changes deploy by push. README has the steps.

### Task layout

```
tasks/<name>/task.json   # config, see below
tasks/<name>/prompt.md   # sent verbatim on stdin to claude
runs/<name>/<runId>/     # gitignored; one directory per run
```

`task.json` fields read by the runner: `model`, `allowedTools` (joined into `--allowedTools`), `timeoutMinutes` (default 15, SIGTERM on expiry), `before` (shell command run in the run dir with `TASK_DIR` set to the task's directory). `schedule` is a cron string that is currently display-only; there is no scheduler yet. Extra keys are allowed and are how `before` scripts get their own config (e.g. `x-ai` keeps its handle list under `"x"`).

Prompts are expected to end with a message that starts with a `# ` title line, since the UI renders `output.md` as markdown.

### Why the claude invocation looks the way it does

- `ANTHROPIC_API_KEY` is deleted from the child env on purpose so `claude` falls back to the subscription login instead of billing an API key.
- `--strict-mcp-config` stops the headless run from inheriting the user's global MCP servers; a task only gets the tools its own config names.
- Model choice per task: use `haiku` when a `before` script has already fetched all the input (the model only reads and summarizes), `sonnet` when the task has to search the web itself.

### `before` scripts

`x-ai` chains three: `fetch-x.ts && fetch-hn.ts && fetch-newsletters.ts` (each as `node ../../../scripts/<file>`). They run with the run directory as cwd, and a non-zero exit marks the run `failed` without starting claude; their output is in `before.log`.

- `scripts/fetch-x.ts` writes `tweets.md` (accounts from remote lists), `tweets-web.md` (hand-picked accounts) and `discourse.md` (techtwitter.com's public API, which needs a browser user agent). Posts come from FxTwitter's `/2/profile/{handle}/statuses`, no API key, 6 fetches in parallel. Handles come from two places under `task.json`'s `"x"` key: `lists` (URLs of JSON exports in the awesome-ai-x-accounts format, filtered by category id) and `handles` (an object of group name to hand-picked handles). Output is grouped by category. Pulling the AI list at run time means those accounts update without editing the config; only the web dev groups are maintained by hand.
- `scripts/fetch-hn.ts` writes `hn.md`: the Hacker News front page plus stories over `hn.minPoints` in the last 24h, via the Algolia HN API.
- `scripts/fetch-newsletters.ts` writes `newsletters.md`: new issues from the RSS feeds under `newsletters.feeds` (the four Cooperpress letters and The Deep View's beehiiv feed), converted to text with links kept. It also writes `newsletters.json` (the issue URLs delivered) and scans sibling run directories for earlier `newsletters.json` files, so an issue is delivered exactly once and missed days are caught up. This is the only per-run state that later runs read.

The prompt tells claude to `Read` all five files.

**Every input file must stay under about 60KB.** Claude Code's `Read` returns at most about 25k tokens and cuts the rest off silently, which is why tweets are split into two files, post text is cut at 600 chars, the tweet files drop the least-liked posts past `x.maxChars`, and the newsletter file defers older issues past `newsletters.maxChars` to the next run. Check `log.jsonl` read sizes against file sizes when adding a source. techtwitter.com is AI and startup heavy and has almost no web dev content, which is why HN and the web dev handle group exist.
