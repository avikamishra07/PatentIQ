import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client.js";
import { ROUTES } from "../src/hooks/useHashRoute.js";
import { DEFAULT_FORM, buildBody, emptyReason, orDash, pct, validateForm } from "../src/utils/suggestions.js";

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
afterEach(() => vi.unstubAllGlobals());
const form = (o = {}) => ({ ...DEFAULT_FORM, description: "solar water pump", ...o });

describe("validateForm", () => {
  it("accepts a normal description", () => expect(validateForm(form())).toBeNull());
  it("rejects empty / whitespace-only input", () => {
    expect(validateForm(form({ description: "   " }))).toMatch(/describe/i);
  });
  it("rejects input with no words", () => expect(validateForm(form({ description: "123 !!!" }))).toMatch(/English words/));
  it("rejects over-long input", () => expect(validateForm(form({ description: "a".repeat(2001) }))).toMatch(/2000/));
  it("checks counts, score and years", () => {
    expect(validateForm(form({ top_k: 0 }))).toMatch(/1 to 30/);
    expect(validateForm(form({ top_k: 31 }))).toMatch(/1 to 30/);
    expect(validateForm(form({ min_score: 2 }))).toMatch(/between 0 and 1/);
    expect(validateForm(form({ year_from: "1500" }))).toMatch(/1800/);
    expect(validateForm(form({ year_from: "2022", year_to: "2020" }))).toMatch(/later/);
  });
});

describe("buildBody", () => {
  it("omits empty filters and trims the description", () => {
    expect(buildBody(form({ description: "  solar pump " }))).toEqual({ description: "solar pump", top_k: 10, min_score: 0.05 });
  });
  it("includes chosen filters with numeric years", () => {
    const b = buildBody(form({ field: "COMPUTER", status: "Granted", office: "Delhi", year_from: "2019", year_to: "2022" }));
    expect(b).toMatchObject({ field: "COMPUTER", status: "Granted", office: "Delhi", year_from: 2019, year_to: 2022 });
  });
});

describe("display helpers", () => {
  it("shows missing values as an em dash", () => {
    expect(orDash(null)).toBe("—"); expect(orDash(undefined)).toBe("—"); expect(orDash("")).toBe("—");
    expect(orDash("2020-01-01")).toBe("2020-01-01");
  });
  it("formats scores and tolerates missing ones", () => {
    expect(pct(0.4567)).toBe("45.7%"); expect(pct(null)).toBe("—");
  });
  it("picks the empty-state heading by whether filters were used", () => {
    expect(emptyReason({ query: { filters: { status: "Granted" } } })).toMatch(/filters/);
    expect(emptyReason({ query: { filters: {} } })).toBe("No suggestions found");
  });
});

describe("api.suggestionsSearch", () => {
  it("POSTs JSON to /suggestions/search and returns the body", async () => {
    const f = vi.fn().mockResolvedValue(json(200, { suggestions: [], returned: 0 }));
    vi.stubGlobal("fetch", f);
    const res = await api.suggestionsSearch({ description: "solar pump", top_k: 5 });
    expect(res.returned).toBe(0);
    const [url, init] = f.mock.calls[0];
    expect(url).toMatch(/\/suggestions\/search$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ description: "solar pump", top_k: 5 });
  });
  it("surfaces 422 validation text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(422, { detail: "The description has no searchable terms." })));
    await expect(api.suggestionsSearch({ description: "method" })).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/searchable/) });
  });
  it("flags a 503 with Retry-After as index-building", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(503, { detail: { retry_after_seconds: 5 } }, { "Retry-After": "5" })));
    await expect(api.suggestionsSearch({ description: "solar" })).rejects.toMatchObject({ isIndexBuilding: true, retryAfter: 5 });
  });
  it("reports an unreachable backend as a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(api.suggestionsSearch({ description: "solar" })).rejects.toMatchObject({ kind: "network" });
  });
});

describe("routing", () => {
  it("registers the suggestions route and keeps all earlier ones", () => {
    for (const r of ["dashboard", "classify", "similarity", "suggestions", "explorer", "analytics", "reports", "status"]) {
      expect(ROUTES).toContain(r);
    }
  });
});
