# Contributing to controlai-web

## Branch Naming

Use one of the following prefixes:

- `feat/` — new features (e.g. `feat/add-site-create-form`)
- `fix/` — bug fixes (e.g. `fix/session-cookie-samesite`)
- `chore/` — tooling, deps, config (e.g. `chore/update-prisma`)
- `docs/` — documentation only
- `test/` — tests only

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

[optional body]

[optional footer]
```

**Types:** `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `ci`

**Examples:**

```
feat(instance): add bearer token rotation UI
fix(auth): clear cookie on sign-out
chore(deps): bump better-auth to 1.6.2
```

The subject line MUST:
- Use the imperative mood ("add" not "added")
- Not exceed 72 characters
- Not end with a period

## Pull Requests

1. Open a PR to `main` with a clear title following the commit convention.
2. All CI checks (lint, typecheck, unit-test, e2e) must pass.
3. Squash-merge is preferred to keep `main` history clean.

## Code Style

- TypeScript strict mode — no `any`, no `@ts-ignore`
- Prettier formatting: `pnpm format`
- ESLint: `pnpm lint`
- Minimum 80% unit test coverage for `packages/api` logic
