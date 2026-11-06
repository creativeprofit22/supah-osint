# AGENTS.md

Bun workspace (TypeScript 7) for supah-osint. Packages ship TypeScript source; `apps/desktop` builds into an Electrobun app.

## Commands

- Install: `bun install` (CI uses `bun install --frozen-lockfile`)
- Typecheck: `bun run typecheck` (the compile check for packages)
- Dev: `bun run dev` (React view hot reload plus Electrobun window)
- Run without Vite: `bun run --cwd apps/desktop start`
- Build (desktop): `bun run --cwd apps/desktop build` (electrobun build, output in `apps/desktop/artifacts`)
- Devkit: `apps/desktop` needs the Electrobun devkit in `apps/desktop/.hutch`, created by `bun run --cwd apps/desktop devkit` (`electrobun prepare`); dev, start, build and typecheck run it
- Test: `bun test`
- Lint: `bun run lint` (oxlint)
- Boundaries: `bun run boundaries` (dependency-cruiser ring rules)
- CI: `bun run check` runs CI's check job; CI also builds Windows with `bun run --cwd apps/desktop build`

## Architecture

Packages follow four onion rings and imports point inward only; see `docs/architecture.md`. Put new packages in the ring their path implies and declare workspace deps as `"workspace:*"`.

## Rules

- CI lives in `.github/workflows/ci.yml` and must stay green.
- Never commit with `--no-verify`.
- Never "fix" the imports in `tests/fixtures/bad-tree`; they are deliberately broken.

## Platform CLIs

Installed and yours to run — use them directly; never send the user to a dashboard for something these answer:

- `gh` — PRs, issues, CI run logs, releases. Auth failure → ask the user to run `gh auth login`, then retry.
