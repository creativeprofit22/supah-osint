import { createMemoryStore } from "../../packages/storage/src/index.ts";
import { storeContract } from "./store-contract.ts";

storeContract("memory store", createMemoryStore);
