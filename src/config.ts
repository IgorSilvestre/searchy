import { env } from "process";

function intFromEnv(name: string, def: number): number {
  const v = env[name];
  if (!v) return def;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

export const OPENAI_API_KEY = env.OPENAI_API_KEY || "";
export const LLM_MODEL = env.LLM_MODEL || "gpt-4o-mini";
export const PG_URL = env.PG_URL || "";
export const CARDS_TTL_SECONDS = intFromEnv("CARDS_TTL_SECONDS", 900);
export const STATEMENT_TIMEOUT_MS = intFromEnv("STATEMENT_TIMEOUT_MS", 3000);
export const MAX_LIMIT = intFromEnv("MAX_LIMIT", 1000);
export const PORT = intFromEnv("PORT", 8080);
export const LOG_LEVEL = (env.LOG_LEVEL || "info").toLowerCase();
export const MOCK_LLM = env.MOCK_LLM === "1" || env.MOCK_LLM === "true";
export const MAX_RESPONSE_BYTES = intFromEnv("MAX_RESPONSE_BYTES", 5 * 1024 * 1024);

export const POOL_MAX = intFromEnv("POOL_MAX", 10);
export const CACHE_POOL_SIZE = intFromEnv("CACHE_POOL_SIZE", 8); // LRU of db URLs

