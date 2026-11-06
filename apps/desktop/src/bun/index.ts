// Bun main process. The only place, with the view's transport, that touches Electrobun.
import { defaultDatabasePath, openStoredRpc } from "@supah-osint/rpc";
import { bunHandlers, type AppSchema } from "@supah-osint/rpc/schema";
import { BrowserView, BrowserWindow, Updater } from "electrobun/bun";

// Opening the store runs any pending migrations before the window appears. Sources default to the domain checks.
const app = openStoredRpc({
  databasePath: defaultDatabasePath(),
  http: {
    get: async (url, options) => {
      const response = await fetch(url, {
        signal: options?.signal,
        method: options?.method ?? "GET",
        headers: options?.headers,
        body: options?.body,
        redirect: options?.redirect ?? "follow",
      });
      return { status: response.status, body: await response.text() };
    },
  },
});
process.on("exit", () => app.close());

const DEV_SERVER_URL = "http://127.0.0.1:5173";
const BUNDLED_VIEW_URL = "views://mainview/index.html";

async function getMainViewUrl(): Promise<string> {
  if ((await Updater.localInfo.channel()) !== "dev") return BUNDLED_VIEW_URL;
  try {
    await fetch(DEV_SERVER_URL, { method: "HEAD" });
    console.log(`Hot reload on: loading ${DEV_SERVER_URL}`);
    return DEV_SERVER_URL;
  } catch {
    console.log("Vite dev server not running; loading the bundled view");
    return BUNDLED_VIEW_URL;
  }
}

const rpc = BrowserView.defineRPC<AppSchema>({
  handlers: {
    requests: bunHandlers({ now: Date.now, bunVersion: Bun.version, sources: app, audits: app }),
    messages: {},
  },
});

new BrowserWindow({
  title: "supah-osint",
  url: await getMainViewUrl(),
  frame: { width: 960, height: 640, x: 120, y: 120 },
  rpc,
});

console.log(`supah-osint main process pid ${process.pid}`);
