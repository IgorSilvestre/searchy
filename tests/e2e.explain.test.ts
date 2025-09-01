import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createApp } from "../src/server";

const TEST_PG_URL = process.env.TEST_PG_URL || process.env.PG_URL;

let server: any;
let baseUrl = "";

async function seed(dbUrl: string) {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS public`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.customers(
        id serial primary key,
        email text not null,
        city text
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.orders(
        id serial primary key,
        customer_id int references public.customers(id),
        total_cents int not null,
        paid boolean default true,
        created_at timestamptz default now()
      );
    `);
  } finally {
    await client.end();
  }
}

describe("e2e /explain", () => {
  beforeAll(async () => {
    if (!TEST_PG_URL) return;
    await seed(TEST_PG_URL);
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns an explanation for a schema question", async () => {
    if (!TEST_PG_URL) {
      console.warn("TEST_PG_URL not set: skipping e2e test");
      expect(true).toBeTrue();
      return;
    }
    process.env.MOCK_LLM = "1";
    const resp = await fetch(`${baseUrl}/explain`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phrase: "what links orders to customers?", dbUrl: TEST_PG_URL }),
    });
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(typeof data.answer).toBe("string");
    expect(data.answer.length).toBeGreaterThan(0);
  });
});

