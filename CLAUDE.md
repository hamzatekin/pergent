# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

pergent is a personal agent runner. Each task is a prompt plus a small JSON config; running a task spawns headless `claude -p` and stores the result on disk and in a SQLite index. A small React PWA is the morning paper that reads the outputs. Prompts and configs are edited in git only. No build step for the Node side.

Keep it minimal: no new runtime dependencies without a clear reason, one feature per step, verified with a real run.

## Commands

Requires Node >= 24 (TypeScript runs directly via type stripping, so `.ts` files are executed with plain `node` and imports use `.ts` extensions).

```sh
npm run task -- list            # list tasks in tasks/
npm run task -- run <name>      # run one task, print output.md and a status line; exit 1 on failure
npm run serve                   # API + static UI on http://localhost:4321 (serves dist/, so build first)
npm run dev                     # API on :4321 plus Vite dev server for web/ on :5173 (proxies /api); Ctrl-C stops both
npm run build                   # vite build -> dist/
npm run typecheck               # tsc for src/ (root tsconfig) and web/ (web/tsconfig.json)
```

There are no tests and no linter. `npm run typecheck` is the only check. The `task` and `serve` scripts (and the Dockerfile `CMD`) pass `--disable-warning=ExperimentalWarning` because `node:sqlite` still prints one on every start.

## Architecture

Five layers, all small:

- `src/runner.ts` is the core. It loads a task from `tasks/<name>/`, creates `runs/<name>/<ISO timestamp>/`, optionally runs the task's `before` shell command in that directory, then spawns `claude -p --output-format stream-json --verbose --strict-mcp-config` with the prompt on stdin and the run directory as cwd. It parses the stream for the final `result` event and writes `meta.json`, `output.md`, `log.jsonl`, `stderr.log`, and saves the run to the database at start, after a failed `before`, and at the end.
- `src/db.ts` is the index over runs: one `runs` table in `runs/pergent.db` (`node:sqlite`, built into Node, WAL mode; the file sits on the `runs` volume) holding the `RunMeta` fields plus `output` and the `images` map, i.e. exactly what the API serves. The run directory stays the archive for the log, stderr, `before.log` and the fetched inputs, and is still what you open to debug. `openDb()` creates the table and backfills any run directory with a `meta.json` that has no row yet, so a fresh database (or a restored volume) catches up on start. Deleting a run directory does not delete its row. The `RunMeta` type is the contract on both sides; `toMeta`/`saveRun` map it to columns.
- `src/server.ts` is a Hono app on `@hono/node-server`, read-only: `GET /api/tasks` (names), `GET /api/tasks/:name/runs[/:runId]` (a run is `meta`, `output` and `images`; the log stays on disk; fetching one counts as a read, see the scheduler), `GET /api/status` (scheduler `off`/`on`/`paused`, last read, pause threshold). There is no run trigger; runs start from the scheduler or the CLI. The reading routes (`/`, `/read`, `/read/:task[/:runId]`) are pre-rendered: the run's markdown goes through `marked` and is injected into `dist/index.html`'s root div with the `# ` line as the `<title>`, because LLM fetchers and crawlers run no JavaScript and would otherwise see an empty shell; the app mounts over it on load. It picks the run the way `Read.tsx` does and does not count as a read for the scheduler. Everything else is `serveStatic` over `dist/` with `index.html` as the fallback (directories, missing paths and SPA routes; routing is non-strict, so a trailing slash is the same page). Every response carries a CSP (`default-src 'self'`, images from any https host) because the reading view injects the model's markdown as HTML unsanitized. `onError` passes an `HTTPException` through with its own status instead of turning it into a 500. Binds to 127.0.0.1 only.
- `src/scheduler.ts` runs tasks on their `schedule` cron string, only when `SCHEDULER=1` (the Dockerfile sets it; a local `npm run serve` never starts runs on its own, use the CLI). It ticks just after every minute boundary, matches five-field cron (`*`, lists, ranges, steps, Vixie-style dom/dow OR) against local time (`TZ`), and skips a task whose latest run started in the same minute so a restart cannot double-fire. **Dead man's switch:** every run the UI fetches is recorded as `last_read` in the `state` table; after `SCHEDULER_PAUSE_DAYS` (default 7) without one the scheduler stops starting tasks, and the next read resumes it. A fresh database has no read, so a new deployment is quiet until the paper is opened once. This exists so a forgotten deployment cannot keep spending subscription usage; `Read.tsx` fetches `/api/status` on mount, before it reads a run, and shows a note when runs were paused.
- `web/` is a React 19 + Tailwind v4 PWA built by Vite (`root: "web"`, output `../dist`). `web/src/api.ts` is the typed client; its `RunMeta` type is a hand-copied subset of the one in `src/runner.ts`, so change both when adding fields. One view: `/`, `/read`, `/read/<task>[/<runId>]` (`web/src/router.tsx` is pushState without a dependency) render `Read.tsx`, the latest ok run with ←/→ between runs. `Read.tsx` lexes the markdown with `marked` and lays it out as a paper: the `# ` line is the masthead, `## ` lines are section heads, each `### ` block is a story card with a lead image (looked up in the run's `images.json` by the story's bare source URL, tracking parameters stripped; feed thumbnails narrower than 300px are dropped on load), the blockquote as an inset aside and the bare URL as a host chip. Light paper palette only, system serif, no web fonts. The PWA `start_url` is `/read`.

`src/cli.ts` is a thin wrapper over the same runner used by the server.

### Deployment

Coolify deploys `compose.yaml` (one `app` service, port 4321 exposed, `runs` and `claude-home` named volumes) from the `Dockerfile` (multi-stage: vite build, then a slim node 24 image with `@anthropic-ai/claude-code` installed globally, `npm ci --omit=dev` for hono, and `src/`, `scripts/`, `tasks/`, `dist/` copied; runs as root so the volumes are always writable). Coolify's proxy does HTTPS. Variables, set in Coolify's UI: `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`; a container has no browser login), `TZ`. There is no auth; the UI is open to anyone who reaches the domain. The server binds `HOST` (default loopback; the image sets `0.0.0.0`) and answers `GET /healthz` for the compose `healthcheck` (Coolify ignores its UI health page for compose apps and Traefik only routes to healthy containers; the check runs with `node -e fetch(...)` because the image has no curl). Tasks are baked into the image, so prompt changes deploy by push. README has the steps.

### Task layout

```
tasks/<name>/task.json   # config, see below
tasks/<name>/prompt.md   # sent verbatim on stdin to claude
runs/<name>/<runId>/     # gitignored; one directory per run
```

`task.json` fields read by the runner: `model`, `allowedTools` (joined into `--allowedTools`), `timeoutMinutes` (default 15, SIGTERM on expiry), `before` (shell command run in the run dir with `TASK_DIR` set to the task's directory). `schedule` is a five-field cron string read by the scheduler (local time of the server's `TZ`). Extra keys are allowed and are how `before` scripts get their own config (e.g. `tech` keeps its handle list under `"x"`).

Prompts are expected to end with a message that starts with a `# ` title line, since the UI renders `output.md` as markdown.

### Why the claude invocation looks the way it does

- `ANTHROPIC_API_KEY` is deleted from the child env on purpose so `claude` falls back to the subscription login instead of billing an API key.
- `--strict-mcp-config` stops the headless run from inheriting the user's global MCP servers; a task only gets the tools its own config names.
- Model choice per task: use `haiku` when a `before` script has already fetched all the input and the job is summarizing (`tech`), `sonnet` when the task has to search the web or needs judgement over sources (`haberler` reads pre-fetched headlines but has to filter clickbait and propaganda and reconcile outlets, and its output is Turkish).

### `before` scripts

`tech` chains three: `fetch-x.ts && fetch-hn.ts && fetch-newsletters.ts` (each as `node ../../../scripts/<file>`). They run with the run directory as cwd, and a non-zero exit marks the run `failed` without starting claude; their output is in `before.log`.

- `scripts/fetch-x.ts` writes `tweets.md` (accounts from remote lists), `tweets-web.md` (hand-picked accounts) and `discourse.md` (techtwitter.com's public API, which needs a browser user agent). Posts come from FxTwitter's `/2/profile/{handle}/statuses`, no API key, 6 fetches in parallel. Handles come from two places under `task.json`'s `"x"` key: `lists` (URLs of JSON exports in the awesome-ai-x-accounts format, filtered by category id) and `handles` (an object of group name to hand-picked handles). Output is grouped by category. Pulling the AI list at run time means those accounts update without editing the config; only the web dev groups are maintained by hand.
- `scripts/fetch-hn.ts` writes `hn.md`: the Hacker News front page plus stories over `hn.minPoints` in the last 24h, via the Algolia HN API.
- `scripts/fetch-newsletters.ts` writes `newsletters.md`: new issues from the RSS feeds under `newsletters.feeds` (the four Cooperpress letters and The Deep View's beehiiv feed), converted to text with links kept. It also writes `newsletters.json` (the issue URLs delivered) and scans sibling run directories for earlier `newsletters.json` files, so an issue is delivered exactly once and missed days are caught up. This is the only per-run state that later runs read.

The prompt tells claude to `Read` all five files.

`haberler` (the Turkish daily paper) chains two: `fetch-rss.ts && fetch-bundle.ts`.

- `scripts/fetch-rss.ts` writes headline files (`haberler-1.md` … `haberler-N.md`, `rss.files` of them, each under `rss.maxChars`) from the news RSS feeds under `rss.feeds`, last `rss.hours` hours, grouped by the `group` each feed declares in task.json. Headline, a 160-char description and a link per item, no bodies; feed groups are dealt round-robin over the files and the busiest feed in a file loses its oldest items first when it goes over the cap. Google News items get the list of outlets covering the story instead of a description, which the prompt uses as a "how many outlets ran this" signal. Feeds were chosen to span international Turkish services, independent, left (BirGün, Evrensel, soL, Artı Gerçek, Kısa Dalga, Özgür Gelecek), opposition mainstream, economy, government-aligned (used for facts only, the prompt says so), celebrity and Google News. T24, Gazete Duvar and NTV block non-browser clients, Bloomberg HT's feed is stale, and Anadolu needs a full browser user agent. Turkish text and URLs tokenize heavily, so files are kept at 38KB, not 60: at 45KB `Read` still cut off around line 130 and claude had to re-read with an offset. It also writes `images.json` (article link to lead image from `media:content`, `media:thumbnail`, `enclosure` or the description's first `<img>`; BBC's 240px and Halk TV's 150x84 thumbnails are rewritten to larger sizes the same CDN paths serve) for the reading view; the headline files never mention images, so the model never sees image URLs. AA, bianet, BirGün, Diken, DW and Medyascope feeds carry no images.
- `scripts/fetch-bundle.ts` writes `bundle.md`: the popular list and the last `bundle.hours` of the main feed from Bundle (bundle.app, the Turkish news aggregator app). Bundle has no official API; these are the keyless JSON routes its web client calls on `www.bundle.app/api/main` (`get-popular`, `get-feed` paginated with `beforeRssDataId`, and an unused `get-summary` POST that returns an AI summary with an importance flag), so they can change or block. The prompt uses the popular list as a second cross-source significance signal. It merges each item's `imageLink` into `images.json`.

**Every input file must stay under about 60KB (38KB for Turkish text).** Claude Code's `Read` returns at most about 25k tokens and cuts the rest off silently, which is why tweets are split into two files, post text is cut at 600 chars, the tweet files drop the least-liked posts past `x.maxChars`, and the newsletter file defers older issues past `newsletters.maxChars` to the next run. Check `log.jsonl` read sizes against file sizes when adding a source. techtwitter.com is AI and startup heavy and has almost no web dev content, which is why HN and the web dev handle group exist.
