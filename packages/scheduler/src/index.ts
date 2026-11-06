// Ring 2 (application): decides when subjects are re-scanned. Time comes from Clock, not Date.
import type { Subject } from "@supah-osint/core";

export type Clock = {
  now(): number;
};

export type ScanPlan = {
  subject: Subject;
  lastScanAt: number | null;
};

export function dueForScan(plans: readonly ScanPlan[], clock: Clock, intervalMs: number): Subject[] {
  const now = clock.now();
  return plans
    .filter((plan) => plan.lastScanAt === null || now - plan.lastScanAt >= intervalMs)
    .map((plan) => plan.subject);
}
