// Ring 3 (adapter): domain registration contacts over RDAP (structured WHOIS), found via the IANA bootstrap.
import { mergeEntities, type Entity, type Finding } from "@supah-osint/core";
import type { Source, SourceContext } from "@supah-osint/engine";
import { bootstrapBase, contactsOf, linkContacts, parseJson, registrarLink } from "./parse.ts";

export type RdapSourceOptions = { now?: () => number };

const ID = "rdap";
export const RDAP_BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";

export function rdapSource(options: RdapSourceOptions = {}): Source {
  const now = options.now ?? Date.now;
  return {
    id: ID,
    accepts: ["Domain"],
    keyRequirement: "none",
    async *run(input: Entity, ctx: SourceContext): AsyncIterable<Finding> {
      if (input.type !== "Domain") return;
      const get = (url: string) => ctx.http.get(url, { signal: ctx.signal });
      const finding = (url: string | null, rest: Pick<Finding, "result" | "reason" | "entities" | "relations">): Finding => ({
        auditId: ctx.audit.id,
        source: ID,
        url,
        foundAt: now(),
        confidence: 1,
        ...rest,
      });
      const inconclusive = (url: string | null, reason: string) =>
        finding(url, { result: "inconclusive", reason, entities: [], relations: [] });

      const bootstrapResponse = await get(RDAP_BOOTSTRAP_URL);
      const bootstrap = bootstrapResponse.status === 200 ? parseJson(bootstrapResponse.body) : null;
      if (!bootstrap) {
        yield inconclusive(RDAP_BOOTSTRAP_URL, `IANA RDAP bootstrap unavailable (HTTP ${bootstrapResponse.status})`);
        return;
      }
      const base = bootstrapBase(bootstrap, input.key);
      if (!base) {
        yield inconclusive(null, `no RDAP server is listed for ${input.key}`);
        return;
      }

      // The registry URL is the finding's slot, so a registrar change still replaces the earlier answer.
      const url = `${base}domain/${encodeURIComponent(input.key)}`;
      const response = await get(url);
      if (response.status === 404) {
        yield finding(url, { result: "not_found", reason: null, entities: [], relations: [] });
        return;
      }
      const record = response.status === 200 ? parseJson(response.body) : null;
      if (!record) {
        yield inconclusive(url, response.status === 200 ? "RDAP answer was not valid JSON" : `RDAP server answered HTTP ${response.status}`);
        return;
      }

      const contacts = contactsOf(record);
      const related = registrarLink(record);
      let registrarFailed: string | null = null;
      if (related && related !== url) {
        const registrar = await get(related);
        const registrarRecord = registrar.status === 200 ? parseJson(registrar.body) : null;
        if (registrarRecord) contacts.push(...contactsOf(registrarRecord));
        else registrarFailed = `registrar RDAP answered HTTP ${registrar.status}`;
      }

      const found = linkContacts(input, contacts);
      if (found.relations.length > 0) {
        yield finding(url, { result: "found", reason: null, entities: mergeEntities([input, ...found.entities]), relations: found.relations });
      } else if (registrarFailed) {
        yield inconclusive(url, registrarFailed);
      } else {
        yield finding(url, { result: "not_found", reason: null, entities: [], relations: [] });
      }
    },
  };
}
