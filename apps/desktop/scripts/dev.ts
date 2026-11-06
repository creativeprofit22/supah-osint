// `bun run dev`: Vite dev server for hot reload + Electrobun app in watch mode.
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const bun = process.execPath;
const DEV_SERVER_URL = "http://127.0.0.1:5173";

async function run(args: string[]): Promise<void> {
  const code = await Bun.spawn([bun, "x", ...args], { cwd, stdio: ["inherit", "inherit", "inherit"] }).exited;
  if (code !== 0) throw new Error(`${args.join(" ")} exited with ${code}`);
}

async function waitForDevServer(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      return;
    } catch {
      await Bun.sleep(200);
    }
  }
  throw new Error(`Vite did not start at ${DEV_SERVER_URL} within ${timeoutMs} ms`);
}

await run(["electrobun", "prepare"]);
// Bundled fallback for views://mainview so the app also works if Vite stops.
await run(["vite", "build"]);

const vite = Bun.spawn([bun, "x", "vite"], { cwd, stdio: ["ignore", "inherit", "inherit"] });
const stopVite = () => vite.kill();
process.on("SIGINT", stopVite);
process.on("SIGTERM", stopVite);

try {
  await waitForDevServer(30_000);
  const app = Bun.spawn([bun, "x", "electrobun", "dev", "--watch"], { cwd, stdio: ["inherit", "inherit", "inherit"] });
  process.exitCode = await app.exited;
} finally {
  stopVite();
}
