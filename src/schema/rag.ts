import { RelationCard } from "../adapters/db";

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_\s.]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function pickTopK(cards: RelationCard[], phrase: string, k = 6): RelationCard[] {
  const qTokens = tokenize(phrase);
  const scores = cards.map((c) => {
    const hay = [c.name, ...c.columns.map((x) => x.name), ...c.join_hints].join(" ").toLowerCase();
    let score = 0;
    for (const t of qTokens) {
      if (!t) continue;
      const re = new RegExp(`\\b${t.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "g");
      const matches = hay.match(re);
      if (matches) score += matches.length;
      // small bonus for exact relation name parts
      if (c.name.includes(t)) score += 0.5;
    }
    // slight bias to smaller relations if we have estimates
    if (typeof c.row_estimate === "number") {
      score += 1 / Math.log10(c.row_estimate + 10);
    }
    return { c, score };
  });
  scores.sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name));
  return scores.slice(0, Math.max(1, k)).map((x) => x.c);
}

