import type { Clock } from "../../packages/engine/src/index.ts";

type Timer = { at: number; resolve: () => void };

export type FakeClock = Clock & {
  // Every requested sleep duration, in order.
  sleeps: number[];
  advance(ms: number): void;
};

// Time only moves when a timer fires. Pending timers fire one at a time once the
// current promise callbacks have run, so a quick response still beats a timeout.
export function createFakeClock(start = 0): FakeClock {
  let now = start;
  let scheduled = false;
  const timers: Timer[] = [];
  const sleeps: number[] = [];

  const fireNext = () => {
    scheduled = false;
    timers.sort((a, b) => a.at - b.at);
    const timer = timers.shift();
    if (!timer) return;
    now = Math.max(now, timer.at);
    timer.resolve();
    schedule();
  };
  const schedule = () => {
    if (scheduled || timers.length === 0) return;
    scheduled = true;
    setImmediate(fireNext);
  };

  return {
    sleeps,
    now: () => now,
    sleep: (ms, signal) => {
      sleeps.push(ms);
      return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason);
        const timer: Timer = {
          at: now + Math.max(0, ms),
          resolve: () => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
          },
        };
        const onAbort = () => {
          timers.splice(timers.indexOf(timer), 1);
          reject(signal?.reason);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        timers.push(timer);
        schedule();
      });
    },
    advance: (ms) => {
      now += ms;
    },
  };
}
