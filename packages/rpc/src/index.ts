// Ring 3 (adapter): the only door from entry points into the app.
import type { Finding, Subject, SubjectId } from "@supah-osint/core";
import { listFindings, runSearch, type EngineDeps } from "@supah-osint/engine";
import { createMemoryStore } from "@supah-osint/storage";

export type Rpc = {
  search(subject: Subject): Promise<Finding[]>;
  findings(subjectId: SubjectId): Promise<Finding[]>;
};

export function createRpc(deps: EngineDeps): Rpc {
  return {
    search: (subject) => runSearch(deps, subject),
    findings: (subjectId) => listFindings(deps, subjectId),
  };
}

export function createLocalRpc(deps: Omit<EngineDeps, "store">): Rpc {
  return createRpc({ ...deps, store: createMemoryStore() });
}
