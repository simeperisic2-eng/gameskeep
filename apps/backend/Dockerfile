# syntax=docker/dockerfile:1
# Build context is the REPO ROOT (so npm workspaces resolve correctly).

# ---- deps: reproducible install from the workspace lockfile ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY packages/shared/package.json packages/shared/
RUN npm ci

# ---- runtime: run the API via tsx (no build step needed) ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Hoisted dependencies live in the root node_modules.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/backend ./apps/backend
# Shared workspace is consumed as TS source (no build step) — its symlink in
# node_modules points here, so the source must be present in the image.
COPY packages ./packages
WORKDIR /app/apps/backend
EXPOSE 4000
# Default command runs the API. The worker service overrides this in compose.
CMD ["npm", "run", "start"]
