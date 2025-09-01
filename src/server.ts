import express from "express";
import { PORT, PG_URL, CARDS_TTL_SECONDS, STATEMENT_TIMEOUT_MS, MAX_LIMIT, MAX_RESPONSE_BYTES } from "./config";
import { logger } from "./utils/logger";
import { PostgresAdapter } from "./adapters/postgres";
import type { IntrospectionAdapter, RelationCard } from "./adapters/db";
import { buildCards } from "./schema/cards";
import { pickTopK } from "./schema/rag";
import { ensureLimit, hasRandomOrder, isSafeSelect, limitValue } from "./guards/sqlGuard";
import { getLLM } from "./llm/llm";
import type { QueryRequest, QueryResponse, ExplainResponse } from "./types";
import { errorHandler } from "./middleware/error";

// Validations
function validateBody(body: any): asserts body is QueryRequest {
  if (!body || typeof body !== "object") throw Object.assign(new Error("Invalid body"), { status: 400 });
  const { phrase, dbUrl } = body as QueryRequest;
  if (typeof phrase !== "string" || phrase.length < 1 || phrase.length > 2000) {
    throw Object.assign(new Error("Invalid phrase"), { status: 400 });
  }
  if (dbUrl !== undefined && typeof dbUrl !== "string") {
    throw Object.assign(new Error("Invalid dbUrl"), { status: 400 });
  }
}

// Cache for relation cards per dbUrl with TTL
const cardsCache = new Map<string, { ts: number; cards: RelationCard[] }>();

function getAdapter(dbUrl: string): IntrospectionAdapter {
  return PostgresAdapter.fromUrl(dbUrl);
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  // Serve minimal static client from /public
  app.use(express.static("public"));

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  app.post("/query", async (req, res, next) => {
    const started = Date.now();
    try {
      validateBody(req.body);
      const { phrase } = req.body as QueryRequest;
      const dbUrl = (req.body as QueryRequest).dbUrl || PG_URL;
      if (!dbUrl) throw Object.assign(new Error("Missing dbUrl"), { status: 400 });

      const adapter = getAdapter(dbUrl);
      await adapter.testConnection();

      let entry = cardsCache.get(dbUrl);
      const now = Date.now();
      const ttlMs = CARDS_TTL_SECONDS * 1000;
      if (!entry || now - entry.ts > ttlMs) {
        const cards = await buildCards(adapter);
        entry = { ts: now, cards };
        cardsCache.set(dbUrl, entry);
      }
      const cards = entry.cards;
      const selected = pickTopK(cards, phrase, 6);
      const selectedNames = selected.map((c) => c.name);

      const llm = getLLM();
      const { sql: rawSql, params } = await llm.generateSQL(phrase, selected, selectedNames);

      if (!isSafeSelect(rawSql)) {
        throw Object.assign(new Error("Generated SQL rejected by guard"), { status: 400 });
      }
      if (hasRandomOrder(rawSql)) {
        throw Object.assign(new Error("ORDER BY random() is not allowed"), { status: 400 });
      }
      const limitedSql = ensureLimit(rawSql, Math.min(MAX_LIMIT, 1000));
      const limit = limitValue(limitedSql);
      if (limit && limit > MAX_LIMIT) {
        throw Object.assign(new Error(`LIMIT exceeds MAX_LIMIT ${MAX_LIMIT}`), { status: 400 });
      }

      await adapter.setTimeoutMs(STATEMENT_TIMEOUT_MS);
      const exec = await adapter.runSelect(limitedSql, params);

      // Optional response size cap
      let rows = exec.rows;
      let rowCount = exec.rowCount;
      let truncated = false;
      let approxBytes = Buffer.byteLength(JSON.stringify(rows));
      if (approxBytes > MAX_RESPONSE_BYTES) {
        // progressively truncate
        let n = rows.length;
        while (n > 0 && approxBytes > MAX_RESPONSE_BYTES) {
          n = Math.max(1, Math.floor(n * 0.7));
          rows = rows.slice(0, n);
          approxBytes = Buffer.byteLength(JSON.stringify(rows));
        }
        truncated = true;
        rowCount = rows.length;
      }

      const response: QueryResponse = { rows, rowCount, sql: limitedSql };
      if (truncated) (response as any).truncated = true;

      const durationMs = Date.now() - started;
      logger.info("query_ok", { phrase, chosenCards: selectedNames, sql: limitedSql, rowCount, durationMs });

      res.json(response);
    } catch (err) {
      next(err);
    }
  });

  app.post("/explain", async (req, res, next) => {
    const started = Date.now();
    try {
      validateBody(req.body);
      const { phrase } = req.body as QueryRequest;
      const dbUrl = (req.body as QueryRequest).dbUrl || PG_URL;
      if (!dbUrl) throw Object.assign(new Error("Missing dbUrl"), { status: 400 });

      const adapter = getAdapter(dbUrl);
      await adapter.testConnection();

      let entry = cardsCache.get(dbUrl);
      const now = Date.now();
      const ttlMs = CARDS_TTL_SECONDS * 1000;
      if (!entry || now - entry.ts > ttlMs) {
        const cards = await buildCards(adapter);
        entry = { ts: now, cards };
        cardsCache.set(dbUrl, entry);
      }
      const cards = entry.cards;
      const selected = pickTopK(cards, phrase, 6);
      const selectedNames = selected.map((c) => c.name);

      const llm = getLLM();
      const { answer, references } = await llm.generateExplanation(phrase, selected, selectedNames);

      const response: ExplainResponse = { answer };
      if (references && Array.isArray(references) && references.length > 0) {
        (response as any).references = references;
      }

      const durationMs = Date.now() - started;
      logger.info("explain_ok", { phrase, chosenCards: selectedNames, durationMs });

      res.json(response);
    } catch (err) {
      next(err);
    }
  });

  app.use(errorHandler);
  return app;
}

if (import.meta.main) {
  const app = createApp();
  app.listen(PORT, () => {
    logger.info("server_listening", { port: PORT });
  });
}
