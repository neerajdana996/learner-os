FROM node:22-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY . .
RUN pnpm build
EXPOSE 3001
# compose overrides CMD to run `drizzle-kit push` first
CMD ["node", "dist/index.js"]
