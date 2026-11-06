# AGENTS.md

Bun workspace (TypeScript 7) for supah-osint. Packages ship TypeScript source; there is no build step yet.

## Commands
- Install: `bun install` (CI uses `bun install --frozen-lockfile`)
- Build: none yet; `bun run typecheck` is the compile check
- Test: `bun test`
- Lint: `bun run lint` (oxlint)
- Boundaries: `bun run boundaries` (dependency-cruiser ring rules)
- Everything CI runs: `bun run check`

## Architecture
Packages follow four onion rings and imports point inward only; see `docs/architecture.md`. Put new packages in the ring their path implies and declare workspace deps as `"workspace:*"`.

## Rules
- CI lives in `.github/workflows/ci.yml` and must stay green.
- Never commit with `--no-verify`.
- Never "fix" the imports in `tests/fixtures/bad-tree`; they are deliberately broken.

## Platform CLIs

Installed and yours to run — use them directly; never send the user to a dashboard for something these answer:
- `gh` — PRs, issues, CI run logs, releases. Auth failure → ask the user to run `gh auth login`, then retry.
