# The build context is the REPO ROOT, not this directory — see the `context: .`
# in docker-compose.yml. A workspace package cannot be installed from inside its
# own folder: pnpm needs the root manifest, the root lockfile and every package
# the filter pulls in.
FROM node:22-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate

# Manifests before sources, so editing a .ts file does not invalidate the
# install layer. `--filter learner-os-backend...` (note the trailing dots)
# resolves the app and everything it depends on, and nothing else.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY backend/package.json backend/
RUN pnpm install --frozen-lockfile --filter learner-os-backend... \
 || pnpm install --filter learner-os-backend...

COPY packages/ packages/
COPY backend/ backend/

# @learnos/shared emits real JS, and the backend resolves it with NodeNext at
# runtime — so it has to be built first. This ordering is the whole reason the
# shared code is a built package rather than consumed as source.
RUN pnpm --filter @learnos/shared build \
 && pnpm --filter learner-os-backend build

EXPOSE 3001
# compose overrides CMD to run `drizzle-kit push` first, and its command runs in
# the package directory, so end here rather than at /app.
WORKDIR /app/backend
CMD ["node", "dist/index.js"]
