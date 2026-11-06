import { expect, test } from "bun:test";
import { Glob } from "bun";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
// A privacy tool must not open ports: app code talks to the window over Electrobun RPC only.
const LISTENER_PATTERNS = [
  /\bBun\.(serve|listen)\s*\(/,
  /["'](node:)?https?["']/,
  /\bcreateServer\s*\(/,
  /\.listen\s*\(/,
];
// Dev tooling only: the Vite dev server serves view files for hot reload and never ships.
const ALLOWED = new Set(["apps/desktop/vite.config.ts", "apps/desktop/scripts/dev.ts"]);
const SKIP = /(^|\/)(node_modules|\.hutch|dist|build|artifacts)\//;

test("app source never starts a server or listens on a port", async () => {
  const offenders: string[] = [];
  for (const top of ["apps", "packages", "features"]) {
    for await (const file of new Glob(`${top}/**/*.{ts,tsx,js,mjs,cjs}`).scan({ cwd: root, dot: true })) {
      const path = file.replaceAll("\\", "/");
      if (SKIP.test(path) || ALLOWED.has(path)) continue;
      const source = await Bun.file(join(root, path)).text();
      if (LISTENER_PATTERNS.some((pattern) => pattern.test(source))) offenders.push(path);
    }
  }
  expect(offenders).toEqual([]);
});

test("the listener check catches Bun.serve", () => {
  expect(LISTENER_PATTERNS.some((pattern) => pattern.test("Bun.serve({ port: 0, fetch })"))).toBe(true);
});
