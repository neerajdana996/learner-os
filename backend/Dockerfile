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
WORKDIR /app/backend
# Bring the schema up to date, then start. Run here — in the NEW container, with
# the NEW schema.ts — rather than as a Coolify pre-deployment command, which runs
# inside the container being replaced and so pushes the previous version's schema
# (and on a first deploy, with nothing running yet, is skipped outright).
#
# No --force: a change that would drop data makes `push` fail, the container
# exits before listening, its health check never passes, and the rolling update
# keeps the old container serving. compose overrides CMD for local development.
CMD ["sh", "-c", "pnpm drizzle-kit push && exec node dist/index.js"]
