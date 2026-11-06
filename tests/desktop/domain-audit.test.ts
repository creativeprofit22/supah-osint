import { expect, test } from "bun:test";
import { createRpc, domainSources } from "../../packages/rpc/src/index.ts";
import { createMemoryStore } from "../../packages/storage/src/index.ts";
import { effRoutes, fixtureHttp } from "../sources/fixture-http.ts";

const CRTSH_URL = "https://crt.sh/?q=%25.eff.org&output=json";

test("a domain audit links the domain to its registrant organization, emails and subdomains", async () => {
  const http = fixtureHttp(effRoutes);
  const rpc = createRpc({ sources: domainSources(), store: createMemoryStore(), http });
  const run = await rpc.auditDomain("Ada Lovelace", "eff.org");

  const types = new Set(run.entities.map((entity) => entity.type));
  expect([...types].sort()).toEqual(expect.arrayContaining(["Domain", "Email", "Organization"]));
  const label = new Map(run.entities.map((entity) => [entity.id, entity.label]));
  const edges = run.relations.map((r) => `${label.get(r.from)} ${r.label} ${label.get(r.to)}`);
  expect(edges).toContain("eff.org registered_by Electronic Frontier Foundation");
  expect(edges).toContain("Electronic Frontier Foundation has_email whois@eff.org");
  expect(edges.some((edge) => edge.endsWith(" subdomain_of eff.org"))).toBe(true);
  expect(edges.some((edge) => edge.startsWith("eff.org has_email "))).toBe(true);
  // Every edge joins two entities from this audit.
  for (const relation of run.relations) {
    expect(label.has(relation.from) && label.has(relation.to)).toBe(true);
  }
  expect((await rpc.findings(run.auditId)).every((finding) => finding.auditId === run.auditId)).toBe(true);
});

test("a failed lookup is reported as inconclusive, not as nothing found", async () => {
  const http = fixtureHttp({ ...effRoutes, [CRTSH_URL]: "packages/sources/crtsh/fixtures/malformed.json" });
  const rpc = createRpc({ sources: domainSources(), store: createMemoryStore(), http });
  const run = await rpc.auditDomain("Ada Lovelace", "eff.org");
  const crtsh = run.findings.filter((finding) => finding.source === "crtsh");
  expect(crtsh.map((finding) => finding.result)).toEqual(["inconclusive"]);
  expect(crtsh[0]?.reason).toBeTruthy();
  expect(run.findings.some((finding) => finding.source === "rdap" && finding.result === "found")).toBe(true);
});
