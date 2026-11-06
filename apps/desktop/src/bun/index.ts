// Bun main process. The only place, with the view's transport, that touches Electrobun.
import { bunHandlers, type AppSchema } from "@supah-osint/rpc/schema";
import { BrowserView, BrowserWindow, Updater } from "electrobun/bun";

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
    requests: bunHandlers({ now: Date.now, bunVersion: Bun.version }),
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
