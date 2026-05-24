# @controlai-web/mqtt-bridge

Standalone Hono + mqtt.js + ioredis SSE telemetry service for controlai-web.

## Overview

The mqtt-bridge subscribes to MQTT brokers on behalf of browsers, fans out live
telemetry via Server-Sent Events (SSE), and buffers messages in Upstash Redis Streams.

## Phase 1: Fly.io deployment

```bash
# From the monorepo root
cd apps/mqtt-bridge

# Authenticate with Fly.io
fly auth login

# Create the app (first time)
fly launch --name controlai-mqtt-bridge --region nrt --no-deploy

# Set secrets
fly secrets set \
  DATABASE_URL="postgresql://..." \
  STREAM_JWT_SECRET="your-32-char-secret" \
  UPSTASH_REDIS_URL="rediss://..." \
  UPSTASH_REDIS_TOKEN="your-token"

# Deploy
fly deploy --app controlai-mqtt-bridge
```

## Phase 2: EC2 sidecar

See `deploy/aws/docker-compose.mqtt-bridge.yml.tmpl` for the Docker Compose template.

```bash
# On the EC2 host
docker compose -f docker-compose.mqtt-bridge.yml up -d
```

Then update Traefik to route `stream.<deployment>.sslip.io → mqtt-bridge:8080`.

## Environment variables

See `.env.example` for all required environment variables.

## API

- `GET /health` — Returns `{ status, activeSites, totalSubscribers }`
- `GET /sites/:siteId/stream?token=<jwt>` — SSE stream; requires valid HS256 JWT from `stream.token` tRPC
