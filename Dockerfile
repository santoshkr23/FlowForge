# FlowForge — production image (Next.js app + built-in scheduler).
# Build:  docker build -t flowforge .
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# DATABASE_URL isn't needed to build (the DB connects lazily at runtime)
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 MEDIA_DIR=/app/data/media
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/package.json /app/next.config.mjs /app/tsconfig.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/db ./db
COPY --from=build --chown=node:node /app/lib ./lib
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/worker ./worker
RUN mkdir -p /app/data/media && chown -R node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
# run database migrations, then start the web server (the scheduler starts inside it when REDIS_URL is unset)
CMD ["sh", "-c", "npx tsx scripts/migrate.ts && npx next start -H 0.0.0.0 -p 3000"]
