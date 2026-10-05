# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Arcade production image.
#
# Build:  docker build -t arcade .
# Run:    docker run -p 3000:3000 --env-file <prod-env-file> arcade
#
# Notes:
# - The runtime is the compiled custom server (dist/server.mjs), not
#   `next start` or the standalone `server.js`. The custom server owns the
#   HTTP upgrade for the realtime/anti-cheat WebSocket on /ws (attachGameWs);
#   the standalone server never wires it, which leaves realtime dead in
#   production.
# - The build needs no real env vars: `next build` does not touch the
#   database, and scripts/run-with-env.mjs silently skips missing env files.
# - Migrations are NOT run by the app image. Run them as a separate deploy
#   step: the `migrate` target (docker build --target migrate) runs
#   `npm run db:migrate` with DATABASE_URL set. See the contributor setup documentation.
# ---------------------------------------------------------------------------

FROM node:24.19.0-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------

FROM node:24.19.0-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------------------------------------------------------------------------

FROM node:24.19.0-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS migrate
WORKDIR /app
ARG ARCADE_VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/odom-technology/tixy"
LABEL org.opencontainers.image.revision="${ARCADE_VCS_REF}"

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY scripts ./scripts
# db:migrate now also runs the idempotent catalog seeds (seed-cosmetics +
# seed-season-0) after applying SQL migrations, so the image needs the full
# src tree the seeds import via the @/ path alias (resolved by tsx through
# tsconfig.json), plus the cosmetics assets the avatar seed probes with
# fs.existsSync to avoid shipping store cards for not-yet-generated art.
COPY src ./src
COPY public/cosmetics ./public/cosmetics

CMD ["npm", "run", "db:migrate"]

# ---------------------------------------------------------------------------

FROM node:24.19.0-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS runner
WORKDIR /app
ARG ARCADE_VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/odom-technology/tixy"
LABEL org.opencontainers.image.revision="${ARCADE_VCS_REF}"

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Production dependencies only. The custom server is bundled at build time so
# the runtime does not need tsx/esbuild.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && \
    # chess-bot.ts only ever loads the lite-single engine; the other
    # stockfish binaries are ~113 MB each and never read at runtime.
    find node_modules/stockfish/bin -type f ! -name 'stockfish-18-lite-single.*' -delete && \
    npm cache clean --force

# Build output, static assets, and the source the custom server imports.
COPY --from=builder --chown=node:node /app/.next ./.next
RUN rm -rf .next/cache .next/standalone
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/dist ./dist

USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/server.mjs"]
