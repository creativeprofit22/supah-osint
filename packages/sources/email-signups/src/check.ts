// Pure: turns one site's HTTP answer into found / not found / inconclusive.
import type { FindingResult } from "@supah-osint/core";
import type { HttpResponse } from "@supah-osint/engine";
import type { SignupSite } from "./sites.ts";

export type Verdict = { result: FindingResult; reason: string | null };

// Anything unclear is inconclusive, never "not found".
export function classify(site: SignupSite, response: HttpResponse): Verdict {
  const { status, body } = response;
  if (status === 429) return { result: "inconclusive", reason: "rate limited (HTTP 429)" };
  if (status !== 200) return { result: "inconclusive", reason: `unexpected HTTP ${status}` };
  const found = site.foundText.some((text) => body.includes(text));
  const missing = site.missingText.some((text) => body.includes(text));
  if (found && missing) return { result: "inconclusive", reason: "answer matched both the found and not-found text" };
  if (found) return { result: "found", reason: null };
  if (missing) return { result: "not_found", reason: null };
  return { result: "inconclusive", reason: "answer had neither the found nor the not-found text" };
}
