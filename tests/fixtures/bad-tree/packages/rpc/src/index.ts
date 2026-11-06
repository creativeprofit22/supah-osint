// Breaks only-storage-touches-sqlite: rpc is an adapter, but only storage may open the database.
import { Database } from "bun:sqlite";

export const db = new Database(":memory:");
