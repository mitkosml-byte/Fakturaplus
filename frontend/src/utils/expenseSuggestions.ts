export interface DescriptionSuggestion {
  description: string;
  amount: number;
}

// Ranks past entries by how often a description recurs (ties broken by
// recency), so the handful of things someone actually logs over and over
// (rent, electricity, fuel...) surface as one-tap chips instead of being
// retyped from scratch every time. Matching is case/whitespace-insensitive
// so "Наем" and "наем " count as the same recurring entry.
export function getDescriptionSuggestions(
  entries: { description: string; amount: number; date: string }[],
  limit = 6
): DescriptionSuggestion[] {
  const byKey = new Map<string, { description: string; amount: number; date: string; count: number }>();
  entries.forEach((e) => {
    const key = e.description.trim().toLowerCase();
    if (!key) return;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { description: e.description.trim(), amount: e.amount, date: e.date, count: 1 });
    } else {
      existing.count += 1;
      if (e.date >= existing.date) {
        existing.description = e.description.trim();
        existing.amount = e.amount;
        existing.date = e.date;
      }
    }
  });
  return Array.from(byKey.values())
    .sort((a, b) => b.count - a.count || (a.date < b.date ? 1 : -1))
    .slice(0, limit)
    .map((e) => ({ description: e.description, amount: e.amount }));
}
