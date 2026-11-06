import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { electrobunViteAliases } from "./.hutch/devkit/api/config/electrobun-vite.ts";

const devkit = fileURLToPath(new URL("./.hutch/devkit", import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: "src/mainview",
  // Relative asset URLs so the bundle also loads from views://mainview/.
  base: "./",
  resolve: { alias: electrobunViteAliases(devkit) },
  build: { outDir: "../../dist", emptyOutDir: true },
  // Vite runs only in dev; packaged builds load views:// and never start it. Electrobun's core still holds its
  // own encrypted loopback socket, unused by app RPC (native bridge forced in src/mainview/electrobun-transport.ts).
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
