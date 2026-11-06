import { expect, test } from "bun:test";
import {
  createSourceGuard,
  RetryExhaustedError,
  SourceParkedError,
  type Http,
  type HttpRequestOptions,
  type HttpResponse,
  type Source,
} from "../../packages/engine/src/index.ts";
import { createFakeClock, type FakeClock } from "./fake-clock.ts";

const TIMEOUT = 15_000;

function source(id: string, extra: Partial<Source> = {}): Source {
  return { id, accepts: ["Person"], keyRequirement: "none", run: async function* () {}, ...extra };
}

// Answers with each step in turn (the last repeats): a status, an Error to throw, or "hang" (waits until aborted).
function scripted(clock: FakeClock, steps: readonly (number | Error | "hang")[]) {
  const calls: { url: string; at: number; options?: HttpRequestOptions }[] = [];
  const http: Http = {
    get: (url, options) => {
      calls.push({ url, at: clock.now(), ...(options ? { options } : {}) });
      const step = steps[Math.min(calls.length, steps.length) - 1] ?? 200;
      if (step === "hang") {
        return new Promise<HttpResponse>((_, reject) => {
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
        });
      }
      if (step instanceof Error) return Promise.reject(step);
      return Promise.resolve({ status: step, body: "" });
    },
  };
  return { http, calls };
}

const backoffs = (clock: FakeClock) => clock.sleeps.filter((ms) => ms !== TIMEOUT);

test("the per-source rate limit wins over the global one, which wins over none", async () => {
  const clock = createFakeClock();
  const guard = createSourceGuard({ clock, defaultRateLimit: { requests: 10, perMs: 1000 } });
  const signal = new AbortController().signal;

  const own = scripted(clock, [200]);
  const strict = guard.http(source("strict", { rateLimit: { requests: 1, perMs: 1000 } }), own.http, signal);
  await strict.get("https://a.test/1");
  await strict.get("https://a.test/2");
  expect(own.calls.map((call) => call.at)).toEqual([0, 1000]);

  const global = scripted(clock, [200]);
  const loose = guard.http(source("loose"), global.http, signal);
  const start = clock.now();
  for (let i = 0; i < 11; i += 1) await loose.get(`https://b.test/${i}`);
  expect(global.calls.slice(0, 10).every((call) => call.at === start)).toBe(true);
  expect(global.calls[10]?.at).toBe(start + 1000);

  const openClock = createFakeClock();
  const open = scripted(openClock, [200]);
  const free = createSourceGuard({ clock: openClock }).http(source("free"), open.http, signal);
  for (let i = 0; i < 50; i += 1) await free.get(`https://c.test/${i}`);
  expect(open.calls.every((call) => call.at === 0)).toBe(true);
  expect(backoffs(openClock)).toEqual([]);
});

test("retries 429, 5xx and timeouts with exponential backoff", async () => {
  const clock = createFakeClock();
  const guard = createSourceGuard({ clock, retry: { attempts: 4 } });
  const signal = new AbortController().signal;

  const busy = scripted(clock, [429, 503, 200]);
  expect((await guard.http(source("busy"), busy.http, signal).get("https://a.test")).status).toBe(200);
  expect(busy.calls).toHaveLength(3);
  expect(backoffs(clock)).toEqual([500, 1000]);

  clock.sleeps.length = 0;
  const start = clock.now();
  const fetchTimeout = Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });
  const slow = scripted(clock, ["hang", fetchTimeout, 200]);
  expect((await guard.http(source("slow"), slow.http, signal).get("https://b.test")).status).toBe(200);
  expect(slow.calls).toHaveLength(3);
  expect(slow.calls[1]?.at).toBe(start + TIMEOUT + 500);
  expect(backoffs(clock)).toEqual([500, 1000]);
});

test("backoff is capped at maxMs", async () => {
  const clock = createFakeClock();
  const guard = createSourceGuard({ clock, retry: { attempts: 5, baseMs: 500, maxMs: 1500 } });
  const flaky = scripted(clock, [500, 500, 500, 500, 200]);
  await guard.http(source("flaky"), flaky.http, new AbortController().signal).get("https://a.test");
  expect(backoffs(clock)).toEqual([500, 1000, 1500, 1500]);
});

test("does not retry other statuses or other errors", async () => {
  const clock = createFakeClock();
  const guard = createSourceGuard({ clock });
  const signal = new AbortController().signal;
  for (const status of [404, 401, 200]) {
    const once = scripted(clock, [status, 200]);
    expect((await guard.http(source(`s${status}`), once.http, signal).get("https://a.test")).status).toBe(status);
    expect(once.calls).toHaveLength(1);
  }
  const broken = scripted(clock, [new Error("boom"), 200]);
  await expect(guard.http(source("broken"), broken.http, signal).get("https://a.test")).rejects.toThrow("boom");
  expect(broken.calls).toHaveLength(1);
  expect(backoffs(clock)).toEqual([]);
});

test("cancelling during a backoff stops without another attempt", async () => {
  const clock = createFakeClock();
  const guard = createSourceGuard({ clock });
  const controller = new AbortController();
  const busy = scripted(clock, [503]);
  const pending = guard.http(source("busy"), busy.http, controller.signal).get("https://a.test");
  pending.catch(() => {});
  while (!clock.sleeps.includes(500)) await Promise.resolve();
  controller.abort(new Error("cancelled"));
  await expect(pending).rejects.toThrow("cancelled");
  expect(busy.calls).toHaveLength(1);
});

test("gives up after the last attempt without the URL in the message", async () => {
  const clock = createFakeClock();
  const guard = createSourceGuard({ clock });
  const down = scripted(clock, [503]);
  const error = await guard
    .http(source("down"), down.http, new AbortController().signal)
    .get("https://api.example.com/?key=SECRET")
    .catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(RetryExhaustedError);
  expect((error as Error).message).toBe("HTTP 503 after 3 attempts");
  expect((error as Error).message).not.toContain("SECRET");
  expect(down.calls).toHaveLength(3);
});

test("parks a failing source, fails fast, and unparks after the cool-down, a success or a revive", async () => {
  const clock = createFakeClock();
  const guard = createSourceGuard({ clock, park: { afterFailures: 3, coolDownMs: 1000 } });
  const base = scripted(clock, [200]);
  const wrapped = guard.http(source("flaky"), base.http, new AbortController().signal);

  guard.recordFailure("flaky");
  guard.recordFailure("flaky");
  expect(guard.isParked("flaky")).toBe(false);
  guard.recordFailure("flaky");
  expect(guard.isParked("flaky")).toBe(true);
  expect(guard.health()).toEqual([{ sourceId: "flaky", state: "parked", failures: 3, parkedUntil: 1000 }]);
  await expect(wrapped.get("https://a.test")).rejects.toBeInstanceOf(SourceParkedError);
  expect(base.calls).toHaveLength(0);

  // Failures while parked don't stretch the park.
  clock.advance(500);
  guard.recordFailure("flaky");
  expect(guard.health()[0]?.parkedUntil).toBe(1000);

  // After the cool-down the next call is a trial; a failed trial re-parks at once.
  clock.advance(500);
  expect(guard.isParked("flaky")).toBe(false);
  guard.recordFailure("flaky");
  expect(guard.isParked("flaky")).toBe(true);

  guard.revive("flaky");
  expect(guard.health()).toEqual([{ sourceId: "flaky", state: "ok", failures: 0, parkedUntil: null }]);
  expect((await wrapped.get("https://a.test")).status).toBe(200);

  // A successful trial after the cool-down clears the park and the failure count.
  for (let i = 0; i < 3; i += 1) guard.recordFailure("flaky");
  clock.advance(1000);
  guard.recordSuccess("flaky");
  guard.recordFailure("flaky");
  expect(guard.isParked("flaky")).toBe(false);
});

test("rotates keys round-robin per source", () => {
  const guard = createSourceGuard({ clock: createFakeClock() });
  const keys = ["a", "b", "c"];
  expect([1, 2, 3, 4].map(() => guard.nextKey("s", keys))).toEqual(["a", "b", "c", "a"]);
  expect(guard.nextKey("other", keys)).toBe("a");
  expect(guard.nextKey("none", [])).toBeNull();
});

test("a fractional source limit below one is kept as one call per longer window and wins over the global one", async () => {
  const clock = createFakeClock();
  const guard = createSourceGuard({ clock, defaultRateLimit: { requests: 10, perMs: 1000 } });
  const slow = scripted(clock, [200]);
  const wrapped = guard.http(
    source("slow", { rateLimit: { requests: 0.5, perMs: 1000 } }),
    slow.http,
    new AbortController().signal,
  );
  await wrapped.get("https://a.test/1");
  await wrapped.get("https://a.test/2");
  expect(slow.calls.map((call) => call.at)).toEqual([0, 2000]);
});

test("a fractional source limit above one rounds down so it never allows more calls than declared", async () => {
  const clock = createFakeClock();
  const guard = createSourceGuard({ clock });
  const base = scripted(clock, [200]);
  const wrapped = guard.http(
    source("odd", { rateLimit: { requests: 1.5, perMs: 1000 } }),
    base.http,
    new AbortController().signal,
  );
  await wrapped.get("https://a.test/1");
  await wrapped.get("https://a.test/2");
  expect(base.calls.map((call) => call.at)).toEqual([0, 1000]);
});

test("passes the method, headers, body and redirect choice through to the real request", async () => {
  const clock = createFakeClock();
  const base = scripted(clock, [200]);
  const wrapped = createSourceGuard({ clock }).http(source("post"), base.http, new AbortController().signal);
  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    redirect: "manual",
  } as const;
  await wrapped.get("https://a.test/check", options);
  expect(base.calls[0]?.options).toMatchObject(options);
  expect(base.calls[0]?.options?.signal).toBeInstanceOf(AbortSignal);
});
