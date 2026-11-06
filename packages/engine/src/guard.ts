// Ring 2 (application): rate limits, timeouts, retries, parking and key rotation shared by every source call.
import type { Clock } from "./clock.ts";
import type { Http, HttpResponse, RateLimit, Source } from "./source.ts";

export class TimeoutError extends Error {
  override name = "TimeoutError";
}

export class RetryExhaustedError extends Error {
  override name = "RetryExhaustedError";
}

export class SourceParkedError extends Error {
  override name = "SourceParkedError";
}

export type RetryOptions = { attempts: number; baseMs: number; maxMs: number };
export type ParkOptions = { afterFailures: number; coolDownMs: number };

export type SourceGuardOptions = {
  clock: Clock;
  // Used for sources that don't declare their own limit.
  defaultRateLimit?: RateLimit;
  retry?: Partial<RetryOptions>;
  timeoutMs?: number;
  park?: Partial<ParkOptions>;
};

export type SourceHealth = {
  sourceId: string;
  state: "ok" | "parked";
  failures: number;
  parkedUntil: number | null;
};

export type SourceGuard = {
  http(source: Source, base: Http, signal: AbortSignal): Http;
  isParked(sourceId: string): boolean;
  recordSuccess(sourceId: string): void;
  recordFailure(sourceId: string): void;
  revive(sourceId: string): void;
  health(): SourceHealth[];
  nextKey(sourceId: string, keys: readonly string[]): string | null;
};

type Health = { failures: number; parkedUntil: number | null };

export function createSourceGuard(options: SourceGuardOptions): SourceGuard {
  const { clock, defaultRateLimit } = options;
  const retry: RetryOptions = { attempts: 3, baseMs: 500, maxMs: 30_000, ...options.retry };
  const park: ParkOptions = { afterFailures: 3, coolDownMs: 600_000, ...options.park };
  const timeoutMs = options.timeoutMs ?? 15_000;
  const limiters = new Map<string, Limiter>();
  const states = new Map<string, Health>();
  const cursors = new Map<string, number>();

  const state = (sourceId: string): Health => {
    let found = states.get(sourceId);
    if (!found) states.set(sourceId, (found = { failures: 0, parkedUntil: null }));
    return found;
  };
  const isParked = (sourceId: string): boolean => {
    const until = states.get(sourceId)?.parkedUntil ?? null;
    return until !== null && clock.now() < until;
  };
  const limiterFor = (source: Source): Limiter => {
    let limiter = limiters.get(source.id);
    if (!limiter) {
      // Priority: the source's own limit, then the global one, then none.
      const limit = normalizeLimit(source.rateLimit) ?? normalizeLimit(defaultRateLimit);
      limiters.set(source.id, (limiter = limit ? slidingWindow(clock, limit) : unlimited));
    }
    return limiter;
  };

  async function attempt(base: Http, url: string, outer: AbortSignal): Promise<HttpResponse> {
    const request = new AbortController();
    const stopTimer = new AbortController();
    const forward = () => request.abort(outer.reason);
    if (outer.aborted) forward();
    else outer.addEventListener("abort", forward, { once: true });
    try {
      const response = base.get(url, { signal: request.signal });
      response.catch(() => {});
      const timedOut = clock.sleep(timeoutMs, stopTimer.signal).then(
        () => "timeout" as const,
        () => "stopped" as const,
      );
      const winner = await Promise.race([response, timedOut]);
      if (winner === "stopped") return await response;
      if (winner === "timeout") {
        const error = new TimeoutError(`timed out after ${timeoutMs} ms`);
        request.abort(error);
        throw error;
      }
      return winner;
    } finally {
      stopTimer.abort();
      outer.removeEventListener("abort", forward);
    }
  }

  return {
    http: (source, base, signal) => ({
      get: async (url, callOptions) => {
        const outer = callOptions?.signal ? anySignal(signal, callOptions.signal) : signal;
        for (let n = 0; ; n += 1) {
          if (isParked(source.id)) throw new SourceParkedError(`${source.id} is parked`);
          await limiterFor(source).acquire(outer);
          let reason: string;
          try {
            const response = await attempt(base, url, outer);
            if (!isRetryableStatus(response.status)) return response;
            reason = `HTTP ${response.status}`;
          } catch (error) {
            if (outer.aborted || !isTimeout(error)) throw error;
            reason = "timed out";
          }
          // The URL may carry an API key, so it never goes in the message.
          if (n + 1 >= retry.attempts) throw new RetryExhaustedError(`${reason} after ${retry.attempts} attempts`);
          await clock.sleep(Math.min(retry.maxMs, retry.baseMs * 2 ** n), outer);
        }
      },
    }),
    isParked,
    recordSuccess: (sourceId) => {
      const health = state(sourceId);
      health.failures = 0;
      health.parkedUntil = null;
    },
    recordFailure: (sourceId) => {
      if (isParked(sourceId)) return;
      const health = state(sourceId);
      health.failures += 1;
      // A failed trial after the cool-down re-parks at once.
      if (health.parkedUntil !== null || health.failures >= park.afterFailures) {
        health.parkedUntil = clock.now() + park.coolDownMs;
      }
    },
    revive: (sourceId) => {
      const health = state(sourceId);
      health.failures = 0;
      health.parkedUntil = null;
    },
    health: () =>
      [...states].map(([sourceId, health]) => {
        const parked = isParked(sourceId);
        return {
          sourceId,
          state: parked ? "parked" : "ok",
          failures: health.failures,
          parkedUntil: parked ? health.parkedUntil : null,
        };
      }),
    nextKey: (sourceId, keys) => {
      if (keys.length === 0) return null;
      const cursor = cursors.get(sourceId) ?? 0;
      cursors.set(sourceId, cursor + 1);
      return keys[cursor % keys.length] ?? null;
    },
  };
}

type Limiter = { acquire(signal: AbortSignal): Promise<void> };

const unlimited: Limiter = { acquire: async () => {} };

function slidingWindow(clock: Clock, limit: RateLimit): Limiter {
  const recent: number[] = [];
  return {
    acquire: async (signal) => {
      while (true) {
        if (signal.aborted) throw signal.reason;
        const now = clock.now();
        while (recent.length > 0 && (recent[0] ?? 0) <= now - limit.perMs) recent.shift();
        if (recent.length < limit.requests) {
          recent.push(now);
          return;
        }
        await clock.sleep((recent[0] ?? now) + limit.perMs - now, signal);
      }
    },
  };
}

// Rounds fractional rates to the safe side: 0.5 per 1000 ms becomes 1 per 2000 ms, 1.5 becomes 1.
function normalizeLimit(limit: RateLimit | undefined): RateLimit | undefined {
  if (limit === undefined) return undefined;
  const { requests, perMs } = limit;
  if (!Number.isFinite(requests) || requests <= 0 || !Number.isFinite(perMs) || perMs <= 0) return undefined;
  if (requests < 1) return { requests: 1, perMs: Math.ceil(perMs / requests) };
  return { requests: Math.floor(requests), perMs };
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

// Also matches what fetch throws for AbortSignal.timeout.
function isTimeout(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "TimeoutError";
}

function anySignal(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController();
  for (const signal of [a, b]) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true, signal: controller.signal });
  }
  return controller.signal;
}
