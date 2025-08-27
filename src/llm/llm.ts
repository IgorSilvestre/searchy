import { OPENAI_API_KEY, LLM_MODEL } from "../config";
import type { RelationCard } from "../adapters/db";

export interface LLMResult {
  sql: string;
  params?: any[];
}

export interface LLM {
  generateSQL(phrase: string, cards: RelationCard[], cardNames: string[]): Promise<LLMResult>;
}

const SYSTEM_PROMPT_TEMPLATE = (
  cardNames: string[],
  cardsJson: string,
) => `You translate natural language into a single **PostgreSQL SELECT** query for the connected database.

Rules (важно):
- Use ONLY these relations (views/tables): ${cardNames.join(", ")}
- Single statement. No semicolons.
- Absolutely forbid: INSERT, UPDATE, DELETE, ALTER, DROP, CREATE, TRUNCATE, COPY, GRANT, REVOKE, VACUUM, ANALYZE.
- Prefer join_hints exactly as provided.
- Always include a LIMIT <= 1000 unless a single row is explicitly requested.
- Use schema-qualified names.
- Output strictly JSON: {"sql":"...","params":[...]} with no extra text.

Context:
{ "relations": [ ${cardsJson} ] }`;

export class OpenAILLM implements LLM {
  constructor(private apiKey: string = OPENAI_API_KEY, private model: string = LLM_MODEL) {
    if (!apiKey) throw new Error("OPENAI_API_KEY missing");
  }

  async generateSQL(phrase: string, cards: RelationCard[], cardNames: string[]): Promise<LLMResult> {
    const sys = SYSTEM_PROMPT_TEMPLATE(cardNames, JSON.stringify(cards));
    // Use fetch to OpenAI-compatible endpoint
    const makeBody = (withTemperature: boolean) => ({
      model: this.model,
      ...(withTemperature ? { temperature: 0 } : {}),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: phrase },
      ],
    });

    const doRequest = async (withTemperature: boolean) => {
      return fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(makeBody(withTemperature)),
      });
    };

    // First try with temperature: 0 (deterministic). If the model rejects
    // the temperature parameter, retry without it (default = 1).
    let resp = await doRequest(true);
    if (!resp.ok) {
      let errorJson: any = undefined;
      try { errorJson = await resp.json(); } catch { /* fall back to text below */ }
      const isTempUnsupported = !!(errorJson && errorJson.error && errorJson.error.code === "unsupported_value" && errorJson.error.param === "temperature");
      if (isTempUnsupported) {
        resp = await doRequest(false);
      }
    }
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`LLM error: ${resp.status} ${t}`);
    }
    const data = await resp.json();
    const content: string = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("LLM returned empty content");
    let parsed: any;
    try { parsed = JSON.parse(content); } catch {
      throw new Error("LLM output not valid JSON");
    }
    if (!parsed.sql || typeof parsed.sql !== "string") throw new Error("LLM JSON missing sql");
    if (parsed.params && !Array.isArray(parsed.params)) throw new Error("LLM JSON params not array");
    return { sql: parsed.sql, params: parsed.params ?? [] };
  }
}

// Deterministic mock for tests/dev
export class MockLLM implements LLM {
  async generateSQL(phrase: string, cards: RelationCard[], cardNames: string[]): Promise<LLMResult> {
    const lower = phrase.toLowerCase();
    // naive heuristics for tests; pick first two relations
    const primary = cards[0];
    if (!primary) throw new Error("No relations available");
    let sql = `SELECT * FROM ${primary.name}`;
    if (/last\s+\d+/.test(lower) && primary.columns.some(c => c.name === 'created_at')) {
      const m = lower.match(/last\s+(\d+)/);
      const n = m ? parseInt(m[1], 10) : 10;
      sql += ` ORDER BY ${primary.name}.created_at DESC LIMIT ${Math.min(1000, n)}`;
    } else {
      sql += ` LIMIT 100`;
    }
    return { sql, params: [] };
  }
}

function isMock(): boolean {
  const v = process.env.MOCK_LLM;
  return v === "1" || v === "true";
}

export function getLLM(): LLM {
  if (isMock()) return new MockLLM();
  return new OpenAILLM();
}
