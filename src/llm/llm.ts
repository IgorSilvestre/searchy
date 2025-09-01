import { OPENAI_API_KEY, LLM_MODEL } from "../config";
import type { RelationCard } from "../adapters/db";

export interface LLMResult {
  sql: string;
  params?: any[];
}

export interface ExplainResult {
  answer: string;
  references?: string[];
}

export interface LLM {
  generateSQL(phrase: string, cards: RelationCard[], cardNames: string[]): Promise<LLMResult>;
  generateExplanation(phrase: string, cards: RelationCard[], cardNames: string[]): Promise<ExplainResult>;
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

const SYSTEM_EXPLAIN_TEMPLATE = (
  cardNames: string[],
  cardsJson: string,
) => `You answer questions about the connected PostgreSQL database schema and relationships.

Rules:
- Use ONLY these relations (views/tables): ${cardNames.join(", ")}
- Base answers strictly on the provided schema context.
- If asked to generate SQL, politely refuse and give an explanation instead.
- Keep answers concise and precise (2-6 sentences when possible).
- Output strictly JSON: {"answer":"...","references":["schema.table", ...]} with no extra text.

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

  async generateExplanation(phrase: string, cards: RelationCard[], cardNames: string[]): Promise<ExplainResult> {
    const sys = SYSTEM_EXPLAIN_TEMPLATE(cardNames, JSON.stringify(cards));
    const body = {
      model: this.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: phrase },
      ],
    };
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
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
    if (!parsed.answer || typeof parsed.answer !== "string") throw new Error("LLM JSON missing answer");
    if (parsed.references && !Array.isArray(parsed.references)) throw new Error("LLM JSON references not array");
    return { answer: parsed.answer, references: parsed.references };
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

  async generateExplanation(phrase: string, cards: RelationCard[], cardNames: string[]): Promise<ExplainResult> {
    const lower = phrase.toLowerCase();
    // Try to find a referenced relation by name substring
    const pickByMention = cards.find(c => lower.includes(c.name.split('.').pop() || c.name));
    const target = pickByMention || cards[0];
    if (!target) return { answer: "No schema information available to explain.", references: [] };
    const cols = target.columns.map(c => `${c.name}${c.pk ? ' (pk)' : ''}${c.fk ? ` -> ${c.fk.ref}` : ''}`).join(', ');
    const refs = target.join_hints && target.join_hints.length > 0
      ? ` It links via: ${target.join_hints.join('; ')}`
      : '';
    const overview = `The relation ${target.name} (${target.kind}) has columns: ${cols}.${refs}`;
    const also = cardNames.length > 1 ? ` Related relations: ${cardNames.filter(n => n !== target.name).join(', ')}.` : '';
    return { answer: overview + also, references: cardNames };
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
