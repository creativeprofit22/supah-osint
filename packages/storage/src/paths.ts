// Where the app keeps its database: the user's app data folder for each platform.
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

const APP_DIR = "supah-osint";
const DB_FILE = "supah-osint.db";

export function defaultDatabasePath(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (platform === "win32") {
    return win32.join(env.APPDATA || win32.join(home, "AppData", "Roaming"), APP_DIR, DB_FILE);
  }
  if (platform === "darwin") {
    return posix.join(home, "Library", "Application Support", APP_DIR, DB_FILE);
  }
  return posix.join(env.XDG_DATA_HOME || posix.join(home, ".local", "share"), APP_DIR, DB_FILE);
}
