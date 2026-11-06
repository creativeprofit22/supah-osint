// Ring 2 (application): use cases. Talks to the outside only through the interfaces below.
import { dedupeFindings, type Finding, type Subject, type SubjectId } from "@supah-osint/core";

export type HttpResponse = { status: number; body: string };

export type Http = {
  get(url: string): Promise<HttpResponse>;
};

export type Source = {
  name: string;
  search(subject: Subject, http: Http): Promise<Finding[]>;
};

export type Store = {
  saveFindings(findings: readonly Finding[]): Promise<void>;
  listFindings(subjectId: SubjectId): Promise<Finding[]>;
};

export type EngineDeps = {
  sources: readonly Source[];
  store: Store;
  http: Http;
};

export async function runSearch(deps: EngineDeps, subject: Subject): Promise<Finding[]> {
  const results = await Promise.all(deps.sources.map((source) => source.search(subject, deps.http)));
  const findings = dedupeFindings(results.flat());
  await deps.store.saveFindings(findings);
  return findings;
}

export function listFindings(deps: Pick<EngineDeps, "store">, subjectId: SubjectId): Promise<Finding[]> {
  return deps.store.listFindings(subjectId);
}
