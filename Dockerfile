# Build the stylesheet and gather the static files, then ship a small runtime with node, claude, and
# the source (no build step for the Node side). Tailwind scans src/ for the classes the page uses.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY web ./web
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321 \
    SCHEDULER=1 \
    DISABLE_AUTOUPDATER=1
# ca-certificates for the fetch scripts and claude; git because claude expects it around.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @anthropic-ai/claude-code
WORKDIR /app
# The server needs hono at runtime; scripts/ and the runner still use only node built-ins (sqlite included).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY scripts ./scripts
# Tasks ship in the image: edit prompts in the repo and push to deploy them. Runs live in a volume.
COPY tasks ./tasks
COPY --from=build /app/dist ./dist
# Runs as root on purpose: the runs volume and claude's home are then writable whatever the host's uids are.
# Nothing here uses --dangerously-skip-permissions.
RUN mkdir -p runs
EXPOSE 4321
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.ts"]
