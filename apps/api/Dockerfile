# syntax=docker/dockerfile:1

# API image for the npm workspaces monorepo.
#
# The build context is the repository root because the workspace lockfile, the
# shared tsconfig and the shared packages live there. Sources are copied after
# the dependency layer, so editing the API does not reinstall node_modules.
#
# The API still runs through tsx: the compiled production target is not wired
# yet, and a later task replaces the CMD with the compiled entry point.

FROM node:22-alpine AS base
WORKDIR /app
ENV NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# Dependency layer: manifests only, so `npm ci` stays cached across source edits.
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/api-contracts/package.json packages/api-contracts/
RUN npm ci

# Temporary runtime bridge until the compiled production build lands. tsx is
# installed without touching package.json or package-lock.json so the manifests
# stay the source of truth for the workspace.
RUN npm install --no-save --no-package-lock tsx@4.23.15

# Runtime layer: application sources plus the installed dependencies.
FROM base AS runtime
# Alpine (musl) needs the tzdata package to resolve America/Lima. Without it TZ
# is ignored and the container silently runs in UTC, which would break the
# system-wide timezone decision (plan §2) for logs and future timestamps.
RUN apk add --no-cache tzdata

ENV TZ=America/Lima \
    API_PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/api/src apps/api/src
COPY packages/api-contracts/package.json packages/api-contracts/package.json
COPY packages/api-contracts/src packages/api-contracts/src

# The API workspace is the working directory so `npm run <script>` resolves
# apps/api/package.json (the migrations job depends on this).
WORKDIR /app/apps/api

USER node
EXPOSE 3000

# Deliberately fails until the /healthz endpoint exists: a healthcheck that
# tolerates a missing endpoint would report a broken API as healthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["npx", "tsx", "src/main.ts"]
