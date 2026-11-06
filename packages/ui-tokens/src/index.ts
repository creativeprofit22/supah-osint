// Ring 4 (entry point): design tokens shared by UI packages.
export const tokens = {
  space: { sm: 4, md: 8, lg: 16 },
  color: { text: "#1b1b1f", accent: "#3b5bdb", danger: "#c92a2a" },
} as const;

export type Tokens = typeof tokens;
