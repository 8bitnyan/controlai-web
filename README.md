# controlai-web

Multi-tenant web control plane for the [controlai](https://github.com/8bitnyan/controlai) IoT provisioning daemon.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS, shadcn/ui |
| API | tRPC v11, Zod |
| Auth | better-auth v1.6+ (email+password, organization plugin) |
| Database | Prisma ORM → Neon Postgres |
| Monorepo | pnpm workspaces + Turborepo |
| Hosting | Vercel (web) + Neon (DB) |

## Repo Layout

```
controlai-web/
├── apps/
│   └── web/              # Next.js 16 App Router application
├── packages/
│   ├── api/              # tRPC server + all routers
│   ├── db/               # Prisma client + schema + migrations
│   └── shared-types/     # Domain enums + Zod schemas shared across packages
├── .github/workflows/    # CI (lint, typecheck, unit, e2e)
├── turbo.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Getting Started

```bash
# Install dependencies
pnpm install

# Copy env file and fill in required values
cp apps/web/.env.example apps/web/.env.local

# Push DB schema
pnpm --filter @controlai-web/db prisma db push

# Seed dev data
pnpm --filter @controlai-web/db prisma db seed

# Start dev server
pnpm dev
```

## Environment Variables

See [`apps/web/.env.example`](apps/web/.env.example) for all required and optional env vars.

## Scripts

| Command | Description |
|---|---|
| `pnpm build` | Build all packages and apps via Turborepo |
| `pnpm dev` | Start all dev servers |
| `pnpm lint` | ESLint across monorepo |
| `pnpm typecheck` | TypeScript type-check across monorepo |
| `pnpm test` | Run Vitest unit tests |
| `pnpm format` | Auto-format with Prettier |
| `pnpm format:check` | Check formatting (used in CI) |

## Architecture

See [openspec/changes/add-controlai-web-skeleton/design.md](../openspec/changes/add-controlai-web-skeleton/design.md) for the architecture decision record.

## License

MIT — Copyright (c) 2026 8bitnyan
