# Architecture: onion rings

supah-osint is a Bun workspace split into four rings. Imports may only point **inward** (toward ring 1). Packages hold plain functions and types; there are no repository classes per entity.

| Ring | Paths | Role | May import |
|---|---|---|---|
| 1 domain | `packages/core` | Pure TypeScript: audits, typed entities with normalized keys, relations limited by an allowed-edge table, and findings (found / not found / inconclusive). No I/O. | Nothing outside itself. No `node:`/Bun builtins, no npm packages. |
| 2 application | `packages/engine`, `packages/scheduler` | Use cases. Define the interfaces they need: `Source`, `Store`, `Http` (engine), `Clock` (scheduler). | Core and ring 2. No builtins: I/O goes through those interfaces. |
| 3 adapters | `packages/sources/*`, `packages/storage`, `packages/evidence`, `packages/removal`, `packages/rpc` | Implement ring 2 interfaces; `rpc` is the one door into the app. | Rings 1–3. Never ring 4. |
| 4 entry points | `apps/desktop`, `packages/ui`, `packages/graph-view`, `packages/ui-tokens`, `features/*` | Desktop app and UI. | Ring 4, `packages/rpc`, and `packages/core` for plain domain types. Never engine, scheduler, storage, sources, evidence or removal. |

```
apps/desktop, ui, graph-view, ui-tokens, features/*   (4)
        │ only through rpc (+ core types)
        ▼
rpc, storage, sources/*, evidence, removal             (3)
        │
        ▼
engine, scheduler                                      (2)
        │
        ▼
core                                                   (1)
```

## Rules

Encoded in [`.dependency-cruiser.cjs`](../.dependency-cruiser.cjs), all errors:

- `package-must-be-in-a-ring`: every module under `packages/`, `apps/` or `features/` must match one of the four ring paths above. A new package goes in the ring list in the config first; otherwise no ring rule would apply to it. `tests/boundaries.test.ts` also catches unringed modules that import nothing.
- `core-is-pure`, `core-no-builtins`: ring 1 imports nothing else.
- `application-inward-only`, `application-no-builtins`: ring 2 imports only core and ring 2.
- `adapters-not-to-entry`: ring 3 never imports ring 4.
- `entry-only-through-rpc`: ring 4 never imports app internals (so the UI never touches storage or sources).
- `only-storage-touches-sqlite`: only `packages/storage` imports `bun:sqlite` (or `node:sqlite`); everything else reaches the database through the engine's `Store`.
- `no-circular`, `not-to-unresolvable`.

Rules match path patterns, so packages that don't exist yet (`sources/*`, `evidence`, `removal`, `features/*`) are covered as soon as they're added. A workspace package can also only import what its `package.json` declares, because Bun links each package's own dependencies.

## Enforcement

`bun run boundaries` checks the real tree. [`tests/boundaries.test.ts`](../tests/boundaries.test.ts) runs the same rules on the real tree (expects no violations) and on [`tests/fixtures/bad-tree`](../tests/fixtures/bad-tree) (expects the exact list of violations, including core importing storage), which proves the checker actually catches outward imports. Both run in CI.

The checker uses the `swc` parser because TypeScript 7 has no JavaScript compiler API for dependency-cruiser to call.
