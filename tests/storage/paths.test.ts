import { expect, test } from "bun:test";
import { defaultDatabasePath } from "../../packages/storage/src/index.ts";

// Built from parts so the expected Windows paths don't depend on escape handling.
const win = (...parts: string[]) => parts.join(String.fromCharCode(92));

test("Windows keeps the database under %APPDATA%", () => {
  const home = win("C:", "Users", "ada");
  const expected = win("C:", "Users", "ada", "AppData", "Roaming", "supah-osint", "supah-osint.db");
  expect(defaultDatabasePath({ APPDATA: win(home, "AppData", "Roaming") }, "win32", home)).toBe(expected);
  expect(defaultDatabasePath({}, "win32", home)).toBe(expected);
});

test("macOS keeps it under Application Support", () => {
  expect(defaultDatabasePath({}, "darwin", "/Users/ada")).toBe(
    "/Users/ada/Library/Application Support/supah-osint/supah-osint.db",
  );
});

test("Linux follows XDG_DATA_HOME, falling back to ~/.local/share", () => {
  expect(defaultDatabasePath({ XDG_DATA_HOME: "/data" }, "linux", "/home/ada")).toBe(
    "/data/supah-osint/supah-osint.db",
  );
  expect(defaultDatabasePath({}, "linux", "/home/ada")).toBe("/home/ada/.local/share/supah-osint/supah-osint.db");
});
