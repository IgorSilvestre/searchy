# Searchy

Plug-and-play NL→SQL API. ExpressJS + TypeScript, Bun, Postgres-first with an adapter interface for future databases. It exposes a single REST endpoint that takes a natural-language phrase, generates a safe SELECT-only SQL using an LLM (OpenAI-compatible JSON mode), executes it with guardrails, and returns JSON rows.

```
Architecture

Client → /query (Express)
  ├─ Validate request, pick dbUrl
  ├─ LRU pool + PostgresAdapter
  ├─ Relation Cards cache (TTL)
  │    ├─ listRelations/describeRelation
  │    └─ listRelationships → join_hints
  ├─ pickTopK(cards, phrase)
  ├─ LLM(JSON mode) → {sql, params}
  ├─ SQL Guard: SELECT-only, LIMIT<=MAX
  ├─ set statement_timeout
  ├─ runSelect(sql, params)
  └─ Return { rows, rowCount, sql }
```

## Quickstart (Bun)

Prereqs: Bun installed, Postgres URL.

```
bun install
bun run dev

curl -s localhost:8080/query \
  -H 'content-type: application/json' \
  -d '{"phrase":"last 10 paid orders with emails","dbUrl":"postgres://user:pass@host:5432/db"}' | jq .
```

Environment variables (.env example):

```
OPENAI_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
PG_URL=postgres://readonly@host:5432/db   # optional default
CARDS_TTL_SECONDS=900
STATEMENT_TIMEOUT_MS=3000
MAX_LIMIT=1000
PORT=8080
LOG_LEVEL=info
MOCK_LLM=0            # set to 1 in tests/dev to avoid network
MAX_RESPONSE_BYTES=5242880
```

Notes:
- `dbUrl` in request overrides `PG_URL`. One must be set.
- If you don’t set `OPENAI_API_KEY`, set `MOCK_LLM=1` for deterministic local runs/tests.

## Docker

```
docker build -t sqlgpt-express .
docker run --rm -p 8080:8080 -e OPENAI_API_KEY=$OPENAI_API_KEY sqlgpt-express
```

Compose with demo Postgres and seed:

```
docker-compose up --build
# API on :8080; DB on :5432; read-only role: app_ro/app_ro_pass
```

## Endpoint

POST `/query`

Request:
```
{ "phrase": "top customers in floripa by revenue", "dbUrl": "postgres://user:pass@host:5432/db" }
```

Response:
```
{ "rows": [...], "rowCount": 123, "sql": "SELECT ... LIMIT 1000" }
```

## Security Defaults

- SELECT-only gate; reject anything else.
- Force LIMIT (cap at `MAX_LIMIT`).
- `statement_timeout` per query.
- Optional response size cap (`MAX_RESPONSE_BYTES`, default 5MB). If exceeded, rows are truncated and a `truncated: true` flag is added.
- Centralized error handler; never echo stack traces.

## Adapters

Implement `IntrospectionAdapter` from `src/adapters/db.ts` for a new DB:

- `testConnection()`
- `listRelations()` → user schemas only
- `describeRelation(name)` → columns, PKs, indexed flags, kind, estimates
- `listRelationships()` → FK graph for join hints
- `setTimeoutMs(ms)` → apply per-connection timeout
- `runSelect(sql, params)` → execute SELECT-only

Add a file like `src/adapters/mysql.ts` implementing the interface and wire `getAdapter()` accordingly.

## LLM Wrapper

`src/llm/llm.ts` provides a provider-agnostic interface. Default is OpenAI-compatible JSON mode with `temperature: 0`. For tests/dev, enable `MOCK_LLM=1` to avoid network calls.

System prompt template is stable and embeds top-K Relation Cards with hard rules (SELECT-only, join_hints, LIMIT<=1000, schema-qualified names) and requires strict JSON output: `{"sql":"...","params":[...]}`.

## Tests

Run: `bun test`

- `tests/unit.guard.test.ts` – SQL guard behavior
- `tests/e2e.query.test.ts` – Spins an Express server and hits `/query`. Uses `MOCK_LLM=1`. Requires `TEST_PG_URL` or `PG_URL` to be set; otherwise skips.

## Pragmatic choices

- Statement timeout is set via `SET statement_timeout` on a borrowed client, then reset to `DEFAULT`.
- Relation estimates rely on `pg_class.reltuples` only; sufficient for ranking. No ANALYZE is triggered.
- `pickTopK` uses keyword scoring over names, columns, and join hints; deterministic and cheap.
- Response truncation is approximate based on JSON byte length and keeps the first N rows.

## License

MIT – see LICENSE.

# searchy
