import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "supah-osint",
    identifier: "dev.supah-osint.desktop",
    version: "0.0.0",
  },
  build: {
    bun: { entrypoint: "src/bun/index.ts" },
    copy: {
      "dist/index.html": "views/mainview/index.html",
      "dist/assets": "views/mainview/assets",
    },
    // Vite rewrites dist/ on every build; the view hot-reloads instead of restarting Bun.
    watchIgnore: ["dist/**"],
    mac: { bundleCEF: false },
    linux: { bundleCEF: false },
    win: { bundleCEF: false },
  },
} satisfies ElectrobunConfig;
