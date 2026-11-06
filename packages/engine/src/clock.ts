// Ring 2 (application): time comes through Clock so tests never really wait.
export type Clock = {
  now(): number;
  // Rejects with the signal's reason when it aborts.
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
};

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = setTimeout(
        () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        },
        Math.max(0, ms),
      );
      signal?.addEventListener("abort", onAbort, { once: true });
    }),
};
