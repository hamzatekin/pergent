# pergent

Personal agent runner. Each task is a prompt plus a small JSON config; running a task spawns headless `claude -p` on your Claude subscription and stores the result on disk, indexed in a SQLite file under `runs/`. A small web app is the morning paper that reads the outputs; prompts and configs are edited in git.

## Local

Requires Node 24 and a logged-in `claude`.

```sh
npm install
npm run build          # stylesheet and static files -> dist/
npm run serve          # http://localhost:4321
npm run task -- run tech
npm run task -- costs  # cost, turns and duration of recent runs
```

## Deploy (Coolify)

The image bundles node, `claude`, the server, the fetch scripts and the tasks. Coolify's proxy does HTTPS. The app has no login of its own.

Once, on your Mac:

```sh
claude setup-token     # prints a long-lived subscription token for headless claude
```

In Coolify:

1. New resource, Docker Compose, from this Git repo. It picks up `compose.yaml`.
2. Environment Variables: `CLAUDE_CODE_OAUTH_TOKEN` (the token). `TZ` is optional (compose defaults it to Europe/London); it sets the clock the prompts see, not the schedule.
3. Set the domain on the `app` service, port 4321.
4. Deploy. Then open `https://<domain>/read` and add it to your phone's home screen; it opens straight into the reading view.

First real run, from the server's terminal in Coolify:

```sh
node src/cli.ts run tech
```

What lives where:

- Tasks ship inside the image. Edit `tasks/<name>/prompt.md` in the repo and push; Coolify redeploys. The site is read-only.
- `runs` is a named volume, so run history and the newsletter delivery state survive redeploys. `claude-home` keeps claude's own state.
- No `.env` file is used. Locally none of the variables are needed: claude uses your own login and the server binds to localhost without auth.

Tasks run on the cron `schedule` in their `task.json`, read in the task's `timezone` (IANA name; without one, the server's `TZ`), but only while the paper is being read: the server notes every run the UI opens, and after 7 days without one it stops scheduling until you open the paper again. A fresh deployment is quiet until the first visit. A slot missed while the server was down, deploying or paused is caught up on the next tick, as long as it was in the last 24 hours. To run a task by hand on the server, open the container (Coolify's terminal button, or `docker exec -it <container> sh` over SSH) and run `node --disable-warning=ExperimentalWarning src/cli.ts run <task>`. Locally the scheduler is off; run tasks with the command above.
