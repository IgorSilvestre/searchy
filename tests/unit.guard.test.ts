import { describe, it, expect } from "bun:test";
import { ensureLimit, isSafeSelect, hasRandomOrder } from "../src/guards/sqlGuard";

describe("sqlGuard", () => {
  it("accepts simple SELECT", () => {
    expect(isSafeSelect("SELECT 1")).toBeTrue();
  });
  it("rejects writes and DDL", () => {
    expect(isSafeSelect("DELETE FROM x")).toBeFalse();
    expect(isSafeSelect("CREATE TABLE x()")) .toBeFalse();
  });
  it("rejects semicolons", () => {
    expect(isSafeSelect("SELECT 1; SELECT 2")).toBeFalse();
  });
  it("rejects system schemas", () => {
    expect(isSafeSelect("SELECT * FROM pg_catalog.pg_tables")) .toBeFalse();
  });
  it("ensures limit when missing", () => {
    expect(ensureLimit("SELECT * FROM a", 100)).toBe("SELECT * FROM a LIMIT 100");
  });
  it("does not change when limit present", () => {
    expect(ensureLimit("SELECT * FROM a LIMIT 5", 100)).toBe("SELECT * FROM a LIMIT 5");
  });
  it("blocks order by random", () => {
    expect(hasRandomOrder("select * from a order by random()")) .toBeTrue();
  });
});

