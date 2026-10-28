import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, buildQuery, formatDetail, parseRetryAfter, request } from "../src/api/client.js";
import { resolveApiBaseUrl } from "../src/config.js";

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

afterEach(() => vi.unstubAllGlobals());

describe("resolveApiBaseUrl", () => {
  it("uses the configured value and strips trailing slashes", () => {
    expect(resolveApiBaseUrl("https://api.example.com//")).toBe("https://api.example.com");
  });
  it("falls back to the local backend when unset or blank", () => {
    expect(resolveApiBaseUrl(undefined)).toBe("http://localhost:8000");
    expect(resolveApiBaseUrl("   ")).toBe("http://localhost:8000");
  });
});

describe("buildQuery", () => {
  it("drops empty, null and undefined values but keeps 0", () => {
    expect(buildQuery({ q: "solar pump", field: "", status: null, year_from: undefined, page: 1, x: 0 }))
      .toBe("?q=solar+pump&page=1&x=0");
  });
  it("returns an empty string when nothing is set", () => {
    expect(buildQuery({ a: "" })).toBe("");
  });
});

describe("formatDetail", () => {
  it("passes plain strings through", () => {
    expect(formatDetail("year_from must not be greater than year_to", 422)).toContain("year_from");
  });
  it("flattens FastAPI validation lists", () => {
    const d = [{ loc: ["body", "description"], msg: "String should have at least 1 character" }, { loc: ["body", "top_k"], msg: "Input should be greater than or equal to 1" }];
    expect(formatDetail(d, 422)).toBe("description: String should have at least 1 character; top_k: Input should be greater than or equal to 1");
  });
  it("includes allowed values from {error, allowed}", () => {
    expect(formatDetail({ error: "Unknown field: 'X'", allowed: ["A", "B"] }, 422)).toBe("Unknown field: 'X' Allowed values: A, B.");
  });
  it("has a generic fallback", () => {
    expect(formatDetail(null, 500)).toBe("Request failed (HTTP 500).");
  });
});

describe("parseRetryAfter", () => {
  it("prefers the header", () => expect(parseRetryAfter("5", { retry_after_seconds: 9 })).toBe(5));
  it("falls back to the body when the header is not readable (CORS)", () => {
    expect(parseRetryAfter(null, { error: "building", retry_after_seconds: 5 })).toBe(5);
  });
  it("is null when neither is present", () => expect(parseRetryAfter(null, "failed")).toBeNull());
});

describe("request", () => {
  it("returns parsed JSON and sends JSON bodies", async () => {
    const f = vi.fn().mockResolvedValue(json(200, { top: [{ field: "COMPUTER", confidence: 40 }], matched: true }));
    vi.stubGlobal("fetch", f);
    const out = await api.predict("neural network");
    expect(out.matched).toBe(true);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("http://localhost:8000/predict");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ title: "neural network" });
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("maps a 503 with Retry-After to an 'index building' error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      json(503, { detail: { error: "Similarity index is still being built; retry shortly.", retry_after_seconds: 5 } }, { "Retry-After": "5" })));
    const err = await api.similaritySearch({ description: "pump" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(503);
    expect(err.retryAfter).toBe(5);
    expect(err.isIndexBuilding).toBe(true);
    expect(err.message).toContain("still being built");
  });

  it("reads the retry hint from the body when the header is hidden", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(503, { detail: { error: "building", retry_after_seconds: 5 } })));
    const err = await request("/similarity/search", { method: "POST", body: {} }).catch((e) => e);
    expect(err.isIndexBuilding).toBe(true);
  });

  it("treats a 503 without a retry hint as unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(503, { detail: "Similarity index unavailable: boom" })));
    const err = await request("/similarity/search", { method: "POST", body: {} }).catch((e) => e);
    expect(err.isUnavailable).toBe(true);
    expect(err.isIndexBuilding).toBe(false);
  });

  it("reports validation errors readably", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(422, { detail: [{ loc: ["body", "description"], msg: "String should have at least 1 character" }] })));
    const err = await request("/similarity/search", { method: "POST", body: {} }).catch((e) => e);
    expect(err.status).toBe(422);
    expect(err.message).toBe("description: String should have at least 1 character");
  });

  it("reports an unreachable backend as a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const err = await api.health().catch((e) => e);
    expect(err.kind).toBe("network");
    expect(err.isNetwork).toBe(true);
    expect(err.message).toContain("http://localhost:8000");
  });

  it("distinguishes a cancelled request from a failure", async () => {
    const ctrl = new AbortController();
    vi.stubGlobal("fetch", vi.fn((_u, init) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("x"), { name: "AbortError" }))))));
    const p = request("/health", { signal: ctrl.signal }).catch((e) => e);
    ctrl.abort();
    expect((await p).kind).toBe("aborted");
  });

  it("times out", async () => {
    vi.stubGlobal("fetch", vi.fn((_u, init) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("x"), { name: "AbortError" }))))));
    const err = await request("/slow", { timeoutMs: 20 }).catch((e) => e);
    expect(err.kind).toBe("timeout");
  });

  it("builds the /patents/search query from filters, skipping blanks", async () => {
    const f = vi.fn().mockResolvedValue(json(200, { total: 0, results: [] }));
    vi.stubGlobal("fetch", f);
    await api.searchPatents({ q: "solar", field: "", status: "Granted", page: 2, page_size: 20, year_from: "" });
    expect(f.mock.calls[0][0]).toBe("http://localhost:8000/patents/search?q=solar&status=Granted&page=2&page_size=20");
  });

  it("does not cache a failed /dataset/stats request", async () => {
    const f = vi.fn().mockRejectedValueOnce(new TypeError("down")).mockResolvedValueOnce(json(200, { total_records: 1 }));
    vi.stubGlobal("fetch", f);
    await expect(api.datasetStats()).rejects.toBeInstanceOf(ApiError);
    await expect(api.datasetStats()).resolves.toEqual({ total_records: 1 });
    await api.datasetStats(); // now cached
    expect(f).toHaveBeenCalledTimes(2);
  });
});
