// Ring 2 (application): decides when audits are re-scanned. Time comes from Clock, not Date.
import type { Audit } from "@supah-osint/core";

export type Clock = {
  now(): number;
};

export type ScanPlan = {
  audit: Audit;
  lastScanAt: number | null;
};

export function dueForScan(plans: readonly ScanPlan[], clock: Clock, intervalMs: number): Audit[] {
  const now = clock.now();
  return plans
    .filter((plan) => plan.lastScanAt === null || now - plan.lastScanAt >= intervalMs)
    .map((plan) => plan.audit);
}
