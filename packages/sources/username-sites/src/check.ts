// Pure: turns one site's HTTP answer into found / not found / inconclusive.
import type { FindingResult } from "@supah-osint/core";
import type { HttpResponse } from "@supah-osint/engine";
import type { Site } from "./sites.ts";

export type Verdict = { result: FindingResult; reason: string | null };

// Found needs both its status and its text, and no not-found signal; anything unclear is inconclusive.
// Redirects are not followed, so a 3xx status reaches here as-is.
export function classify(site: Site, response: HttpResponse): Verdict {
  const { status, body } = response;
  const foundStatus = status === site.eCode;
  const missingStatus = status === site.mCode;
  // Empty text means "status alone", which can only signal anything when the two codes differ.
  const found = foundStatus && (site.eString !== "" ? body.includes(site.eString) : site.eCode !== site.mCode);
  const missing = missingStatus && (site.mString !== "" ? body.includes(site.mString) : site.mCode !== site.eCode);
  if (found && missing)
    return { result: "inconclusive", reason: `HTTP ${status} matched both the found and not-found signals` };
  if (found) return { result: "found", reason: null };
  if (missing) return { result: "not_found", reason: null };
  if (foundStatus)
    return { result: "inconclusive", reason: `HTTP ${status} but the expected profile text was missing` };
  if (missingStatus)
    return { result: "inconclusive", reason: `HTTP ${status} but the expected not-found text was missing` };
  return { result: "inconclusive", reason: `unexpected HTTP ${status}` };
}
