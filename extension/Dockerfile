# Build context is the REPO ROOT — see `context: .` in docker-compose.yml.
FROM node:22-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY extension/package.json extension/
# --ignore-scripts skips `wxt prepare`, which needs the sources that have not
# been copied yet; it is run explicitly below.
RUN pnpm install --frozen-lockfile --ignore-scripts --filter learner-os-extension... \
 || pnpm install --ignore-scripts --filter learner-os-extension...

COPY packages/ packages/
COPY extension/ extension/
RUN pnpm --filter @learnos/shared build \
 && pnpm --filter learner-os-extension exec wxt prepare

WORKDIR /app/extension
# Build-only service: `docker compose run --rm extension` drops the zip into ./dist
CMD ["sh", "-c", "pnpm build && pnpm zip && mkdir -p dist && cp -r .output/* dist/"]
