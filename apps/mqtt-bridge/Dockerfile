# Multi-stage build for mqtt-bridge service
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/mqtt-bridge/package.json ./apps/mqtt-bridge/
COPY packages/db/package.json ./packages/db/
COPY packages/shared-types/package.json ./packages/shared-types/

# Install dependencies
RUN pnpm install --frozen-lockfile --filter @controlai-web/mqtt-bridge...

# Copy source
COPY apps/mqtt-bridge/ ./apps/mqtt-bridge/
COPY packages/db/ ./packages/db/
COPY packages/shared-types/ ./packages/shared-types/

# Build
WORKDIR /app/apps/mqtt-bridge
RUN pnpm exec tsc --outDir dist

# ── Runner ────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 mqttbridge

COPY --from=builder --chown=mqttbridge:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=mqttbridge:nodejs /app/apps/mqtt-bridge/dist ./dist
COPY --from=builder --chown=mqttbridge:nodejs /app/apps/mqtt-bridge/package.json ./

USER mqttbridge

EXPOSE 8080

CMD ["node", "dist/index.js"]
