# pergent

Personal agent runner. Each task is a prompt plus a small JSON config; running a task spawns headless `claude -p` on your Claude subscription and stores the result on disk. A small web app is the morning paper that reads the outputs; prompts and configs are edited in git.

## Local

Requires Node 24 and a logged-in `claude`.

```sh
npm install
npm run build          # web UI -> dist/
npm run serve          # http://localhost:4321
npm run task -- run x-ai
```

## Deploy (Coolify)

The image bundles node, `claude`, the server, the fetch scripts and the tasks. Coolify's proxy does HTTPS; the app does its own basic-auth login.

Once, on your Mac:

```sh
claude setup-token     # prints a long-lived subscription token for headless claude
```

In Coolify:

1. New resource, Docker Compose, from this Git repo. It picks up `compose.yaml`.
2. Environment Variables: `CLAUDE_CODE_OAUTH_TOKEN` (the token), `BASIC_AUTH_USER`, `BASIC_AUTH_PASSWORD`, `TZ`.
3. Set the domain on the `app` service, port 4321.
4. Deploy. Then open `https://<domain>/read` and add it to your phone's home screen; it opens straight into the reading view.

First real run, from the server's terminal in Coolify:

```sh
node src/cli.ts run x-ai
```

What lives where:

- Tasks ship inside the image. Edit `tasks/<name>/prompt.md` in the repo and push; Coolify redeploys. The site is read-only.
- `runs` is a named volume, so run history and the newsletter delivery state survive redeploys. `claude-home` keeps claude's own state.
- No `.env` file is used. Locally none of the variables are needed: claude uses your own login and the server binds to localhost without auth.

There is no scheduler yet. `schedule` in `task.json` is display-only, so runs happen when you call the command above or `POST /api/tasks/<name>/run`.
