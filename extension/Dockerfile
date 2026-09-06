FROM node:22-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile --ignore-scripts || pnpm install --ignore-scripts
COPY . .
RUN pnpm wxt prepare
# Build-only service: `docker compose run --rm extension` drops the zip into ./dist
CMD ["sh", "-c", "pnpm build && pnpm zip && mkdir -p dist && cp -r .output/* dist/"]
