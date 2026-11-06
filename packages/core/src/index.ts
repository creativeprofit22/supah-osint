// Ring 1 (domain): pure types and functions. No I/O, no imports from other packages.

export type SubjectId = string;

export type Subject = {
  id: SubjectId;
  name: string;
};

export type Finding = {
  subjectId: SubjectId;
  source: string;
  url: string;
  foundAt: number;
};

export function findingKey(finding: Finding): string {
  return `${finding.subjectId}|${finding.source}|${finding.url}`;
}

export function dedupeFindings(findings: readonly Finding[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const finding of findings) {
    if (!seen.has(findingKey(finding))) seen.set(findingKey(finding), finding);
  }
  return [...seen.values()];
}
