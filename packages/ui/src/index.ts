// Ring 4 (entry point): UI building blocks. Reaches the app only through @supah-osint/rpc.
import { tokens } from "@supah-osint/ui-tokens";

export type BadgeTone = "accent" | "danger";

export function badgeStyle(tone: BadgeTone): { color: string; padding: number } {
  return { color: tokens.color[tone], padding: tokens.space.sm };
}
