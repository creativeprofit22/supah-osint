// The site-list schema (WhatsMyName field names) and a validator that rejects bad entries one by one.
import { readFile } from "node:fs/promises";
import { err, ok, type Result } from "@supah-osint/core";
import bundled from "../data/wmn-data.json" with { type: "json" };

export type Site = {
  name: string;
  // Contains "{account}", replaced by the username.
  uriCheck: string;
  // Human-facing profile URL when it differs from uriCheck.
  uriPretty: string | null;
  // Found signal: this status and this text in the body (empty text means status only).
  eCode: number;
  eString: string;
  // Not-found signal: this status and this text in the body (empty text means status only).
  mCode: number;
  mString: string;
  // Characters removed from the username before it goes into the URL.
  stripBadChar: string;
  category: string;
  valid: boolean;
  // Some sites are checked with a POST; "{account}" in the body is replaced too.
  postBody: string | null;
  headers: Readonly<Record<string, string>>;
};

export type Rejected = { index: number; reason: string };
export type SiteList = { sites: Site[]; rejected: Rejected[] };

export const NSFW_CATEGORY = "xx NSFW xx";

export function parseSiteList(text: string): Result<SiteList> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return err("site list is not valid JSON");
  }
  return validateSiteList(data);
}

export function validateSiteList(data: unknown): Result<SiteList> {
  const raw = isRecord(data) ? data.sites : undefined;
  if (!Array.isArray(raw)) return err("site list has no sites array");
  const sites: Site[] = [];
  const rejected: Rejected[] = [];
  raw.forEach((entry: unknown, index) => {
    const site = toSite(entry);
    if (site.ok) sites.push(site.value);
    else rejected.push({ index, reason: site.error });
  });
  return ok({ sites, rejected });
}

let cached: SiteList | null = null;

export function bundledSiteList(): SiteList {
  if (cached) return cached;
  const list = validateSiteList(bundled);
  if (!list.ok) throw new Error(`bundled site list is broken: ${list.error}`);
  cached = list.value;
  return cached;
}

// An updated list on disk; on failure the caller keeps using the bundled one.
export async function readSiteListFile(path: string): Promise<Result<SiteList>> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    return err(`could not read site list ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseSiteList(text);
}

function toSite(entry: unknown): Result<Site> {
  if (!isRecord(entry)) return err("entry is not an object");
  const name = entry.name;
  if (typeof name !== "string" || name.trim() === "") return err("missing name");
  const label = (reason: string) => err<Site>(`${name}: ${reason}`);
  const { uri_check: uriCheck, uri_pretty: uriPretty, post_body: postBody } = entry;
  if (typeof uriCheck !== "string" || !isHttpUrl(uriCheck)) return label("uri_check is not an http(s) URL");
  if (uriPretty != null && (typeof uriPretty !== "string" || !isHttpUrl(uriPretty))) {
    return label("uri_pretty is not an http(s) URL");
  }
  if (postBody != null && typeof postBody !== "string") return label("post_body must be text");
  const hasPlaceholder =
    uriCheck.includes("{account}") || (typeof postBody === "string" && postBody.includes("{account}"));
  if (!hasPlaceholder) return label("uri_check has no {account} placeholder");
  const { e_code: eCode, m_code: mCode, e_string: eString, m_string: mString } = entry;
  if (!isStatus(eCode) || !isStatus(mCode)) return label("e_code and m_code must be HTTP status numbers");
  if (typeof eString !== "string" || typeof mString !== "string") return label("e_string and m_string must be text");
  if (eCode === mCode && eString === mString) return label("found and not-found signals are identical");
  const headers = entry.headers ?? {};
  if (!isRecord(headers) || !Object.values(headers).every((v) => typeof v === "string")) {
    return label("headers must map names to text");
  }
  const strip = entry.strip_bad_char;
  if (strip != null && typeof strip !== "string") return label("strip_bad_char must be text");
  return ok({
    name,
    uriCheck,
    uriPretty: typeof uriPretty === "string" ? uriPretty : null,
    eCode,
    eString,
    mCode,
    mString,
    stripBadChar: strip ?? "",
    category: typeof entry.cat === "string" ? entry.cat : "",
    valid: entry.valid !== false,
    postBody: typeof postBody === "string" ? postBody : null,
    headers: headers as Record<string, string>,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStatus(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.replaceAll("{account}", "x"));
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
