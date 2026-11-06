import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cruise, type IConfiguration, type ICruiseResult } from "dependency-cruiser";

const root = join(import.meta.dir, "..");
// The first cruise loads dependency-cruiser and swc cold, which can pass bun's 5s default.
const TIMEOUT = 30_000;
const config = require("../.dependency-cruiser.cjs") as IConfiguration & {
  rings: Record<"CORE" | "APPLICATION" | "ADAPTERS" | "ENTRY", string>;
};
const rings = Object.values(config.rings).map((pattern) => new RegExp(pattern));

// Catches unringed modules even when they import nothing, which the forbidden rule can't see.
function unringed(result: ICruiseResult): string[] {
  return result.modules
    .map((m) => m.source)
    .filter((source) => /^(packages|apps|features)\//.test(source))
    .filter((source) => !rings.some((ring) => ring.test(source)))
    .sort();
}

async function violations(baseDir: string): Promise<{ list: string[]; result: ICruiseResult }> {
  const { output } = await cruise(["packages", "apps", "features"], {
    ...config.options,
    baseDir,
    validate: true,
    ruleSet: { forbidden: config.forbidden },
  });
  const result = output as ICruiseResult;
  const list = (result.summary.violations ?? [])
    .map((v) => `${v.rule.name}: ${v.from} → ${v.to}`)
    .sort();
  return { list, result };
}

describe("onion import rules", () => {
  test("the real workspace has no violations", async () => {
    const { list, result } = await violations(root);
    expect(list).toEqual([]);
    expect(unringed(result)).toEqual([]);
    // Proves workspace imports resolve to real package paths, so the path rules apply to them.
    const desktop = result.modules.find((m) => m.source === "apps/desktop/src/index.ts");
    expect(desktop?.dependencies.map((d) => d.resolved)).toContain("packages/rpc/src/index.ts");
  }, TIMEOUT);

  test("the bad fixture tree reports every outward import", async () => {
    const { list, result } = await violations(join(root, "tests/fixtures/bad-tree"));
    expect(unringed(result)).toEqual(["packages/unringed/src/index.ts"]);
    expect(list).toEqual([
      "adapters-not-to-entry: packages/storage/src/index.ts → packages/graph-view/src/index.ts",
      "application-inward-only: packages/engine/src/index.ts → packages/storage/src/index.ts",
      "core-is-pure: packages/core/src/index.ts → packages/storage/src/index.ts",
      "core-no-builtins: packages/core/src/io.ts → fs",
      "entry-only-through-rpc: apps/desktop/src/index.ts → packages/engine/src/index.ts",
      "entry-only-through-rpc: features/demo/src/index.ts → packages/engine/src/index.ts",
      "entry-only-through-rpc: packages/ui/src/index.ts → packages/storage/src/index.ts",
      "only-storage-touches-sqlite: packages/rpc/src/index.ts → bun:sqlite",
      "package-must-be-in-a-ring: packages/unringed/src/index.ts → packages/core/src/index.ts",
    ]);
  }, TIMEOUT);

  test("core importing storage fails the check", async () => {
    const { list } = await violations(join(root, "tests/fixtures/bad-tree"));
    expect(list).toContain("core-is-pure: packages/core/src/index.ts → packages/storage/src/index.ts");
  }, TIMEOUT);

  test("only packages/storage may import bun:sqlite", async () => {
    const { list } = await violations(join(root, "tests/fixtures/bad-tree"));
    expect(list).toContain("only-storage-touches-sqlite: packages/rpc/src/index.ts → bun:sqlite");
    const real = await violations(root);
    const sqliteUsers = real.result.modules
      .filter((m) => m.dependencies.some((d) => d.resolved === "bun:sqlite"))
      .map((m) => m.source);
    expect(sqliteUsers.length).toBeGreaterThan(0);
    expect(sqliteUsers.every((source) => source.startsWith("packages/storage/"))).toBe(true);
  }, TIMEOUT);
});
