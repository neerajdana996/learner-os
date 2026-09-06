# Build context is the REPO ROOT — see `context: .` in docker-compose.yml.
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile --filter learner-os-frontend... \
 || pnpm install --filter learner-os-frontend...

COPY packages/ packages/
COPY frontend/ frontend/

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
# @learnos/ui is plain SCSS and needs no build; @learnos/shared does, because
# the frontend typechecks against its emitted declarations.
RUN pnpm --filter @learnos/shared build \
 && pnpm --filter learner-os-frontend build

# compose targets this stage for dev and runs `pnpm dev` from the package dir.
WORKDIR /app/frontend

FROM nginx:alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
