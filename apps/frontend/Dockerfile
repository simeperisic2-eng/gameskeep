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

# ---- build: produce the Next.js standalone output ----
FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/frontend ./apps/frontend
# Present so the workspace symlink in node_modules isn't dangling during build.
COPY packages ./packages
RUN npm run build -w apps/frontend

# ---- runtime: lean standalone server ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Standalone bundle (includes a minimal node_modules + server.js) and assets.
COPY --from=build /app/apps/frontend/.next/standalone ./
COPY --from=build /app/apps/frontend/.next/static ./apps/frontend/.next/static
COPY --from=build /app/apps/frontend/public ./apps/frontend/public
EXPOSE 3000
CMD ["node", "apps/frontend/server.js"]
