# Contributing to protoimsg

Thanks for your interest in contributing! protoimsg is AIM-inspired group chat built on the AT Protocol, and we welcome contributions of all kinds.

## Prerequisites

- Node.js 22+
- [pnpm](https://pnpm.io/) 9+
- Docker (for Postgres)

## Setup

```bash
git clone https://github.com/grisha/protoimsg.git
cd protoimsg
pnpm install

# Start Postgres
docker compose up -d

# Configure and migrate
cp packages/server/.env.example packages/server/.env
pnpm --filter @protoimsg/server db:migrate

# Optional: seed dev DB with sample rooms and messages
pnpm --filter @protoimsg/server db:seed

# Run dev servers
pnpm dev
```

Server runs on `http://localhost:3000`, web app on `http://localhost:5173`.

## Project Structure

```
packages/
  shared/    # @protoimsg/shared — types + constants
  lexicon/   # @protoimsg/lexicon — ATProto Lexicon schemas + codegen
  server/    # @protoimsg/server — Express + WebSocket + Jetstream consumer
  ui/        # @protoimsg/ui — CSS Modules design system
  web/       # @protoimsg/web — React frontend
  desktop/   # @protoimsg/desktop — Tauri desktop wrapper
```

## Development Workflow

1. **Branch from `staging`** — use descriptive branch names (`fix/presence-visibility`, `feat/poll-ui`).
2. **Make your changes** — see style guidelines below.
3. **Validate** before pushing:
   ```bash
   pnpm lint          # ESLint (strict TS)
   pnpm typecheck     # TypeScript
   pnpm test          # Vitest
   pnpm build         # Full build
   ```
4. **Open a PR** against `staging`. CI runs lint, typecheck, build, lexicon validation, and tests. Merges to `main` are done via release cuts.

## Commit Messages

This repo uses [Conventional Commits](https://www.conventionalcommits.org/) enforced by commitlint.

```
feat(server): add poll vote counting
fix(web): prevent stale closure in buddy list
chore(ci): add format check to pipeline
```

Common prefixes: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `style`.

## Code Style

### TypeScript

- Strict mode, no `any`
- ESM modules throughout
- Express routers use factory functions
- DB queries use postgres.js tagged templates (no ORM, no raw SQL strings)

### CSS

- **CSS Modules only** — no Tailwind in TSX, no inline style objects for layout
- **Always use design tokens** — never hardcode `px`, `rem`, hex colors, or `rgb()` values
- Tokens live in `packages/ui/src/tokens/index.css` (`var(--cm-*)`, `var(--color-*)`)
- If a token doesn't exist for the value you need, add it to the tokens file first

### ATProto / Lexicon

- Lexicon schemas are in `packages/lexicon/schemas/`
- After modifying schemas, run `pnpm --filter @protoimsg/lexicon codegen` to regenerate types
- `knownValues` fields are open sets — don't use strict enums for these in firehose validation
- Reference [Bluesky](https://github.com/bluesky-social) and [Blacksky](https://github.com/blacksky-algorithms/blacksky.community) for ATProto conventions

## Testing

```bash
pnpm test                                    # all tests
pnpm --filter @protoimsg/server test         # server only
```

Integration tests (`*.integration.test.ts`) require a running Postgres instance and are skipped in CI by default.

## Reporting Issues

Open an issue on GitHub. Include:

- What you expected vs what happened
- Steps to reproduce
- Browser/OS if it's a frontend issue

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
