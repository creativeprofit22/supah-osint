// Pure parsing of Have I Been Pwned breach lists. Only name, title and date are kept, by design.
export type ParsedBreach = { name: string; title: string; breachDate: string | null };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// null means the body was not the breach array HIBP returns, or an item had no name.
export function parseBreaches(body: string): ParsedBreach[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const breaches: ParsedBreach[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) return null;
    const { Name, Title, BreachDate } = item as { Name?: unknown; Title?: unknown; BreachDate?: unknown };
    if (typeof Name !== "string" || Name.trim() === "") return null;
    breaches.push({
      name: Name,
      title: typeof Title === "string" ? Title : Name,
      breachDate: typeof BreachDate === "string" && DATE.test(BreachDate) ? BreachDate : null,
    });
  }
  return breaches;
}
