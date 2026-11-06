// Ring 2 (application): the plugin contract every lookup source implements.
import type { Audit, Entity, EntityType, Finding } from "@supah-osint/core";

export type HttpResponse = { status: number; body: string };

export type HttpRequestOptions = {
  signal?: AbortSignal;
  // Defaults to GET; POST sends `body`.
  method?: "GET" | "POST";
  headers?: Readonly<Record<string, string>>;
  body?: string;
  // "manual" hands back a 3xx answer as-is instead of following it (default "follow").
  redirect?: "follow" | "manual";
};

export type Http = {
  // Named for the common case; `options.method` can make it a POST.
  get(url: string, options?: HttpRequestOptions): Promise<HttpResponse>;
};

export type KeyRequirement = "none" | "optional" | "required";

// At most `requests` calls in any `perMs` window; fractional rates are rounded down to the safe side.
export type RateLimit = { requests: number; perMs: number };

export type SourceContext = {
  audit: Audit;
  http: Http;
  // Pass it on so cancelling stops the request too: ctx.http.get(url, { signal: ctx.signal }).
  signal: AbortSignal;
  key: string | null;
};

export type Source = {
  id: string;
  accepts: readonly EntityType[];
  keyRequirement: KeyRequirement;
  // Wins over the app-wide default limit.
  rateLimit?: RateLimit;
  // Dry run: false means skip this input without doing any lookup.
  canRun?(input: Entity, ctx: SourceContext): boolean;
  run(input: Entity, ctx: SourceContext): AsyncIterable<Finding>;
};
