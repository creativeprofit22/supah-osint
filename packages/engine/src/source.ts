// Ring 2 (application): the plugin contract every lookup source implements.
import type { Audit, Entity, EntityType, Finding } from "@supah-osint/core";

export type HttpResponse = { status: number; body: string };

export type Http = {
  get(url: string, options?: { signal?: AbortSignal }): Promise<HttpResponse>;
};

export type KeyRequirement = "none" | "optional" | "required";

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
  // Dry run: false means skip this input without doing any lookup.
  canRun?(input: Entity, ctx: SourceContext): boolean;
  run(input: Entity, ctx: SourceContext): AsyncIterable<Finding>;
};
