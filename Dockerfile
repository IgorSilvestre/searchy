# syntax=docker/dockerfile:1
FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bunfig.toml tsconfig.json ./
COPY src ./src
RUN bun install --ci
RUN bun run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/dist ./dist
COPY package.json ./package.json
EXPOSE 8080
CMD ["bun", "run", "dist/server.js"]

