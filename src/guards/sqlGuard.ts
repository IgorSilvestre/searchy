const BANNED = /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|COPY|GRANT|REVOKE|VACUUM|ANALYZE)\b/i;

export function isSafeSelect(sql: string): boolean {
  const s = sql.trim();
  if (!/^(SELECT|WITH)\b/i.test(s)) return false;
  if (s.includes(";")) return false;
  if (BANNED.test(s)) return false;
  if (/\b(pg_catalog|information_schema)\./i.test(s)) return false;
  return true;
}

export function ensureLimit(sql: string, max = 1000): string {
  const s = sql.trim();
  if (/\blimit\b/i.test(s)) return s; // respect existing limit; guard ensures <= MAX elsewhere
  // Avoid appending inside parentheses; just add at end
  return `${s} LIMIT ${max}`;
}

export function hasRandomOrder(sql: string): boolean {
  return /order\s+by\s+random\s*\(\s*\)/i.test(sql);
}

export function limitValue(sql: string): number | undefined {
  const m = sql.match(/\blimit\s+(\d+)/i);
  return m ? parseInt(m[1], 10) : undefined;
}

