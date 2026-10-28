// ============================================================================
// Central API layer. Every backend call in the app goes through request().
// Endpoints and payloads below mirror the FastAPI code in backend/:
//   main.py          GET /health, /stats, /metrics      POST /predict
//   dataset_api.py   GET /dataset/stats, /patents/search
//   similarity_api   POST /similarity/search   GET /similarity/status, /similarity/filters
//   suggestions_api  POST /suggestions/search
//   analytics.py     GET /analytics/grant-rate, /analytics/application-types, /analytics/insights
//   report.py        POST /report/generate
// ============================================================================
import { API_BASE_URL } from "../config.js";

export class ApiError extends Error {
  constructor(message, { status = null, kind = "http", detail = null, retryAfter = null, path = "" } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;       // HTTP status, or null for network/timeout/abort
    this.kind = kind;           // "http" | "network" | "timeout" | "aborted"
    this.detail = detail;       // raw `detail` from the backend, if any
    this.retryAfter = retryAfter; // seconds, from the Retry-After header or body
    this.path = path;
  }
  /** 503 that says "try again shortly" (similarity index still building). */
  get isIndexBuilding() {
    return this.status === 503 && this.retryAfter != null;
  }
  /** 503 without a retry hint (index failed, dataset missing). */
  get isUnavailable() {
    return this.status === 503 && this.retryAfter == null;
  }
  get isNetwork() {
    return this.kind === "network" || this.kind === "timeout";
  }
}

/** Turn FastAPI's three `detail` shapes into one readable sentence. */
export function formatDetail(detail, status) {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map((d) => {
        const loc = Array.isArray(d?.loc) ? d.loc.filter((x) => x !== "body" && x !== "query").join(".") : "";
        const msg = d?.msg || "Invalid value";
        return loc ? `${loc}: ${msg}` : msg;
      })
      .join("; ");
  }
  if (detail && typeof detail === "object") {
    if (typeof detail.error === "string") {
      const allowed = Array.isArray(detail.allowed) && detail.allowed.length
        ? ` Allowed values: ${detail.allowed.join(", ")}.` : "";
      return `${detail.error}${allowed}`;
    }
    return JSON.stringify(detail);
  }
  return `Request failed${status ? ` (HTTP ${status})` : ""}.`;
}

/** Retry-After header (seconds or HTTP-date), else retry_after_seconds in the body. */
export function parseRetryAfter(headerValue, detail) {
  if (headerValue != null && headerValue !== "") {
    const secs = Number(headerValue);
    if (Number.isFinite(secs) && secs >= 0) return secs;
    const when = Date.parse(headerValue);
    if (!Number.isNaN(when)) return Math.max(0, Math.ceil((when - Date.now()) / 1000));
  }
  const fromBody = detail && typeof detail === "object" ? detail.retry_after_seconds : null;
  return Number.isFinite(fromBody) ? fromBody : null;
}

export function buildQuery(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export async function request(path, { method = "GET", params, body, timeoutMs = 60000, signal } = {}) {
  const url = `${API_BASE_URL}${path}${buildQuery(params)}`;
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  const onOuterAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", onOuterAbort, { once: true });
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
    if (timedOut) {
      throw new ApiError(`The request to ${path} timed out after ${Math.round(timeoutMs / 1000)} s.`, { kind: "timeout", path });
    }
    if (signal?.aborted || err?.name === "AbortError") {
      throw new ApiError("Request cancelled.", { kind: "aborted", path });
    }
    throw new ApiError(
      `Cannot reach the PatentIQ API at ${API_BASE_URL}. Check that the backend is running and VITE_API_BASE_URL is correct.`,
      { kind: "network", path },
    );
  }

  try {
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = null; }
    }
    if (!res.ok) {
      const detail = data && typeof data === "object" && "detail" in data ? data.detail : null;
      throw new ApiError(formatDetail(detail, res.status), {
        status: res.status,
        detail,
        retryAfter: res.status === 503 ? parseRetryAfter(res.headers.get("Retry-After"), detail) : null,
        path,
      });
    }
    if (data === null) {
      throw new ApiError(`The API returned an unreadable response for ${path}.`, { status: res.status, path });
    }
    return data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (timedOut) throw new ApiError(`The request to ${path} timed out.`, { kind: "timeout", path });
    if (signal?.aborted || err?.name === "AbortError") throw new ApiError("Request cancelled.", { kind: "aborted", path });
    throw new ApiError(`Failed to read the response from ${path}.`, { status: res.status, path });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}

// The first dataset request after server start loads a 180 MB CSV, so allow a long wait.
const SLOW = 180000;

// Dataset-wide statistics are identical for every caller; share one in-flight/finished request.
let datasetStatsPromise = null;

export const api = {
  health: (signal) => request("/health", { signal, timeoutMs: 10000 }),
  modelStats: (signal) => request("/stats", { signal }),
  modelMetrics: (signal) => request("/metrics", { signal }),
  /** body: { title } -> { top: [{field, confidence}], matched } */
  predict: (title, signal) => request("/predict", { method: "POST", body: { title }, signal }),

  datasetStats: () => {
    if (!datasetStatsPromise) {
      datasetStatsPromise = request("/dataset/stats", { timeoutMs: SLOW }).catch((e) => {
        datasetStatsPromise = null; // never cache a failure
        throw e;
      });
    }
    return datasetStatsPromise;
  },
  /** params: q, field, status, office, application_number, publication_number, year_from, year_to, sort, page, page_size */
  searchPatents: (params, signal) => request("/patents/search", { params, signal, timeoutMs: SLOW }),

  /** body: { description, top_k, min_score, max_per_title, field?, status?, office?, year_from?, year_to? } */
  similaritySearch: (body, signal) => request("/similarity/search", { method: "POST", body, signal }),
  similarityStatus: (signal) => request("/similarity/status", { signal, timeoutMs: 15000 }),
  similarityFilters: (signal) => request("/similarity/filters", { signal }),

  /** body: same shape as similaritySearch (top_k <= 30, default max_per_title 2). Reuses the similarity index. */
  suggestionsSearch: (body, signal) => request("/suggestions/search", { method: "POST", body, signal }),
  /** Groq-hosted Innovation Assistant; credentials stay on the backend. */
  innovationChatStatus: (signal) => request("/suggestions/chat/status", { signal, timeoutMs: 5000 }),
  innovationChat: (body, signal) => request("/suggestions/chat", { method: "POST", body, signal, timeoutMs: 70000 }),

  grantRate: (signal) => request("/analytics/grant-rate", { signal }),
  applicationTypes: (signal) => request("/analytics/application-types", { signal }),
  insights: (signal) => request("/analytics/insights", { signal }),

  /** body: { title, project_name? } */
  generateReport: (body, signal) => request("/report/generate", { method: "POST", body, signal }),
};
