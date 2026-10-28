import React, { useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";
import { useSystemStatus } from "../hooks/useSystemStatus.jsx";
import { T } from "../theme.js";
import { fieldLabel, fmt, sleep, strengthTier } from "../utils/format.js";
import {
  Button, EmptyState, ErrorBanner, Field, LoadingBlock, Notice, Panel, SectionHeading, Select, StatusPill,
} from "../components/ui.jsx";

// Limits mirror SimilarityRequest / similarity_engine constants.
const MAX_DESCRIPTION = 2000;
const MAX_RETRIES = 40;            // ~3 minutes of 5 s retries while the index builds
const DEFAULTS = { top_k: 10, min_score: 0.05, max_per_title: 3 };

function buildBody(form) {
  const body = {
    description: form.description.trim(),
    top_k: Number(form.top_k),
    min_score: Number(form.min_score),
    max_per_title: Number(form.max_per_title),
  };
  for (const k of ["field", "status", "office"]) if (form[k]) body[k] = form[k];
  for (const k of ["year_from", "year_to"]) if (form[k] !== "") body[k] = Number(form[k]);
  return body;
}

function validate(form) {
  if (!form.description.trim()) return "Describe the invention first.";
  const int = (v, lo, hi) => Number.isInteger(Number(v)) && Number(v) >= lo && Number(v) <= hi;
  if (!int(form.top_k, 1, 50)) return "Results to return must be a whole number from 1 to 50.";
  if (!int(form.max_per_title, 1, 10)) return "Records per identical title must be a whole number from 1 to 10.";
  const ms = Number(form.min_score);
  if (form.min_score === "" || Number.isNaN(ms) || ms < 0 || ms > 1) return "Minimum score must be between 0 and 1.";
  for (const k of ["year_from", "year_to"]) if (form[k] !== "" && !int(form[k], 1800, 2200)) return "Years must be whole numbers between 1800 and 2200.";
  if (form.year_from !== "" && form.year_to !== "" && Number(form.year_from) > Number(form.year_to)) return "“From year” must not be later than “To year”.";
  return null;
}

export default function Similarity({ prefill, navigate }) {
  const sys = useSystemStatus();
  const [form, setForm] = useState({ description: "", field: "", status: "", office: "", year_from: "", year_to: "", ...DEFAULTS });
  const [phase, setPhase] = useState("idle"); // idle | searching | waiting | done | error
  const [wait, setWait] = useState(null);     // { left, attempt }
  const [formError, setFormError] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const abortRef = useRef(null);

  const filters = useAsync((s) => api.similarityFilters(s), [sys.level], { enabled: sys.level === "ready" });
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => { if (prefill?.text) setForm((f) => ({ ...f, description: prefill.text.slice(0, MAX_DESCRIPTION) })); }, [prefill]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const busy = phase === "searching" || phase === "waiting";

  const run = async () => {
    const problem = validate(form);
    setFormError(problem);
    if (problem) return;
    const body = buildBody(form);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setError(null); setPhase("searching"); setWait(null);
    let attempt = 0;
    try {
      for (;;) {
        try {
          const res = await api.similaritySearch(body, ctrl.signal);
          setResult(res); setPhase("done"); setWait(null);
          return;
        } catch (err) {
          // 503 + Retry-After: the index is still building. Wait the advertised time and retry.
          if (err.isIndexBuilding && attempt < MAX_RETRIES) {
            attempt += 1;
            const total = Math.max(1, Math.min(Math.ceil(err.retryAfter || 5), 30));
            for (let left = total; left > 0; left -= 1) {
              setPhase("waiting"); setWait({ left, attempt });
              await sleep(1000, ctrl.signal);
            }
            setPhase("searching"); setWait(null);
            continue;
          }
          throw err;
        }
      }
    } catch (err) {
      if (err.kind === "aborted") { setPhase(result ? "done" : "idle"); setWait(null); return; }
      setError(err); setPhase("error"); setWait(null);
    }
  };

  const cancel = () => abortRef.current?.abort();
  const reset = () => { setForm((f) => ({ ...f, field: "", status: "", office: "", year_from: "", year_to: "", ...DEFAULTS })); setFormError(null); };

  const opts = filters.data;
  const filterHint = sys.level === "ready"
    ? (filters.error ? "Filter options could not be loaded." : undefined)
    : "Filter options load once the index is ready.";

  return (
    <div style={{ maxWidth: 960 }}>
      <SectionHeading
        title="Similar patent search"
        subtitle="Describe your invention in plain words. PatentIQ ranks patent titles that share the same key terms and shows which words and phrases matched."
      />

      {sys.level !== "ready" && (
        <Notice tone={sys.level === "unavailable" ? "warn" : "info"} style={{ marginBottom: 20 }}>
          {sys.level === "unavailable"
            ? <>Similarity search is unavailable: {sys.error} </>
            : <>The similarity index is {sys.level === "checking" ? "being checked" : "still building"}{sys.status?.building_for_s != null ? ` (${Math.round(sys.status.building_for_s)} s so far)` : ""}. You can submit a search now; it will run automatically as soon as the index is ready. </>}
          <button className="pq-linkbtn" onClick={() => navigate("status")}>System status</button>
        </Notice>
      )}

      <Panel>
        <Field label="Invention description" htmlFor="sim-desc">
          <textarea id="sim-desc" className="pq-input" rows={4} maxLength={MAX_DESCRIPTION} value={form.description}
            onChange={(e) => set("description")(e.target.value)}
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !busy) run(); }}
            placeholder="e.g. solar powered water pump for irrigation" />
        </Field>
        <div style={{ fontFamily: T.mono, fontSize: 12, color: T.grayLight, margin: "6px 0 18px" }}>{form.description.length}/{MAX_DESCRIPTION}</div>

        <div className="pq-form-grid">
          <Field label="Field" htmlFor="sim-field" hint={filterHint}>
            <Select id="sim-field" value={form.field} onChange={set("field")} options={opts?.field || []} disabled={!opts} format={fieldLabel} />
          </Field>
          <Field label="Status" htmlFor="sim-status">
            <Select id="sim-status" value={form.status} onChange={set("status")} options={opts?.status || []} disabled={!opts} />
          </Field>
          <Field label="Patent office" htmlFor="sim-office">
            <Select id="sim-office" value={form.office} onChange={set("office")} options={opts?.office || []} disabled={!opts} />
          </Field>
          <Field label="From year" htmlFor="sim-yf" hint="Publication year">
            <input id="sim-yf" className="pq-input" type="number" min={1800} max={2200} placeholder="Any" value={form.year_from} onChange={(e) => set("year_from")(e.target.value)} />
          </Field>
          <Field label="To year" htmlFor="sim-yt">
            <input id="sim-yt" className="pq-input" type="number" min={1800} max={2200} placeholder="Any" value={form.year_to} onChange={(e) => set("year_to")(e.target.value)} />
          </Field>
        </div>
        {filters.error && sys.level === "ready" && (
          <div style={{ marginTop: 12 }}><ErrorBanner error={filters.error} title="Could not load filter options" onRetry={filters.reload} /></div>
        )}

        <details style={{ marginTop: 18 }}>
          <summary className="pq-linkbtn" style={{ display: "inline-block" }}>Advanced settings</summary>
          <div className="pq-form-grid" style={{ marginTop: 14 }}>
            <Field label="Results to return" htmlFor="sim-topk" hint="1–50">
              <input id="sim-topk" className="pq-input" type="number" min={1} max={50} value={form.top_k} onChange={(e) => set("top_k")(e.target.value)} />
            </Field>
            <Field label="Minimum score" htmlFor="sim-min" hint="0–1. Lower values show weaker matches.">
              <input id="sim-min" className="pq-input" type="number" min={0} max={1} step={0.01} value={form.min_score} onChange={(e) => set("min_score")(e.target.value)} />
            </Field>
            <Field label="Records per identical title" htmlFor="sim-mpt" hint="1–10">
              <input id="sim-mpt" className="pq-input" type="number" min={1} max={10} value={form.max_per_title} onChange={(e) => set("max_per_title")(e.target.value)} />
            </Field>
          </div>
        </details>

        {formError && <div style={{ marginTop: 16 }}><Notice tone="warn">{formError}</Notice></div>}

        <div style={{ marginTop: 20, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Button onClick={run} disabled={busy || !form.description.trim()}>{busy ? "Searching…" : "Search similar patents"}</Button>
          {busy && <Button variant="secondary" onClick={cancel}>Cancel</Button>}
          <Button variant="ghost" onClick={reset} disabled={busy}>Reset filters</Button>
        </div>
      </Panel>

      <div style={{ marginTop: 28 }} aria-live="polite">
        {phase === "searching" && <LoadingBlock label="Searching patent titles…" />}
        {phase === "waiting" && wait && (
          <LoadingBlock
            label={`The similarity index is still building. Retrying in ${wait.left} s…`}
            hint={`The server answered 503 with a Retry-After hint. Attempt ${wait.attempt} of up to ${MAX_RETRIES}; you can cancel at any time.`}
          />
        )}
        {phase === "error" && error && (
          <ErrorBanner
            title={error.isIndexBuilding ? "The index is taking longer than expected" : error.isUnavailable ? "Similarity search is unavailable" : error.status === 422 || error.status === 400 ? "This search can't be run" : "The search failed"}
            error={error}
            onRetry={run}
          >
            {error.isUnavailable && (
              <div style={{ marginTop: 8 }}><button className="pq-linkbtn" onClick={() => navigate("status")}>Open system status</button></div>
            )}
          </ErrorBanner>
        )}
        {result && phase !== "searching" && phase !== "waiting" && phase !== "error" && <Results data={result} navigate={navigate} />}
        {!result && phase === "idle" && (
          <EmptyState title="No search yet">Describe an invention above and search to see ranked, explained matches.</EmptyState>
        )}
      </div>
    </div>
  );
}

function Results({ data, navigate }) {
  const q = data.query;
  const filterEntries = Object.entries(q.filters || {});
  return (
    <div>
      <Notice tone="info" style={{ marginBottom: 18 }}>{data.disclaimer}</Notice>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <h3 style={{ fontFamily: T.sans, fontSize: 17, fontWeight: 600, margin: 0, color: T.ink }}>
          {data.returned} {data.returned === 1 ? "match" : "matches"}
        </h3>
        <span style={{ fontFamily: T.sans, fontSize: 12.5, color: T.gray }}>
          {fmt(data.titles_with_any_overlap)} titles share at least one term · {data.elapsed_ms} ms{data.cache_hit ? " · cached result" : ""}
        </span>
      </div>

      {q.key_terms?.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <span style={{ fontFamily: T.sans, fontSize: 12.5, color: T.gray, marginRight: 8 }}>Key terms used (rarer terms weigh more):</span>
          {q.key_terms.map((t) => <span key={t.term} className="pq-chip" title={`IDF ${t.idf}`}>{t.term}</span>)}
        </div>
      )}
      {q.terms_not_in_dataset?.length > 0 && (
        <Notice tone="warn" style={{ marginBottom: 10 }}>These words don&apos;t appear in any indexed title and were ignored: {q.terms_not_in_dataset.join(", ")}.</Notice>
      )}
      {filterEntries.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <span style={{ fontFamily: T.sans, fontSize: 12.5, color: T.gray, marginRight: 8 }}>Filters applied:</span>
          {filterEntries.map(([k, v]) => <span key={k} className="pq-chip pq-chip-muted">{k.replace("_", " ")}: {k === "field" ? fieldLabel(String(v)) : String(v)}</span>)}
        </div>
      )}
      {data.scan_truncated && (
        <Notice tone="warn" style={{ marginBottom: 10 }}>With these filters, only the best-ranked 20,000 titles were examined, so some matching records may be missing. Narrow the description or loosen the filters.</Notice>
      )}
      {data.note && <Notice tone="info" style={{ marginBottom: 10 }}>{data.note}</Notice>}

      {data.results.length === 0 ? (
        <EmptyState title="No similar patents found">
          Try more specific words, lower the minimum score under Advanced settings, or loosen the filters.
        </EmptyState>
      ) : (
        <ol style={{ listStyle: "none", margin: "16px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {data.results.map((r, i) => <ResultCard key={`${r.application_number}-${r.publication_number}-${i}`} r={r} rank={i + 1} navigate={navigate} />)}
        </ol>
      )}

      <details style={{ marginTop: 24 }}>
        <summary className="pq-linkbtn" style={{ display: "inline-block" }}>How scores are calculated</summary>
        <div style={{ fontFamily: T.sans, fontSize: 13, color: T.gray, lineHeight: 1.6, marginTop: 10, maxWidth: 640 }}>
          <p style={{ margin: "0 0 6px" }}>{data.method.type}. Score range: {data.method.score_range}.</p>
          <p style={{ margin: "0 0 6px" }}>Ranking: {data.method.ranking}.</p>
          <p style={{ margin: "0 0 6px" }}>Ignored: {data.method.ignored}.</p>
          <p style={{ margin: 0 }}>Index: {fmt(data.method.indexed_titles)} distinct titles from {fmt(data.method.indexed_records)} records.</p>
        </div>
      </details>
    </div>
  );
}

function ResultCard({ r, rank, navigate }) {
  const tier = strengthTier(r.match_strength);
  const meta = [
    ["Publication no.", r.publication_number], ["Application no.", r.application_number],
    ["Published", r.publication_date], ["Filed", r.filing_date], ["Office", r.office],
  ];
  return (
    <li style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: "16px 18px" }}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <div style={{ fontFamily: T.mono, fontSize: 13, color: T.grayLight, minWidth: 26, paddingTop: 2 }}>#{rank}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: T.sans, fontSize: 15, fontWeight: 600, color: T.ink, lineHeight: 1.45, overflowWrap: "anywhere" }}>{r.title}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "8px 0" }}>
            <StatusPill tier={tier} label={r.match_strength} />
            <span className="pq-chip pq-chip-muted" style={{ margin: 0 }}>{fieldLabel(r.field)}</span>
            <span className="pq-chip pq-chip-muted" style={{ margin: 0 }}>{r.status}</span>
            {r.records_with_this_title > 1 && (
              <span style={{ fontFamily: T.sans, fontSize: 12, color: T.gray }}>{fmt(r.records_with_this_title)} records share this title</span>
            )}
          </div>
          <div style={{ fontFamily: T.sans, fontSize: 12.5, color: T.gray, display: "flex", flexWrap: "wrap", gap: "2px 18px" }}>
            {meta.map(([k, v]) => <span key={k}>{k} <span style={{ fontFamily: T.mono, color: T.ink }}>{v || "—"}</span></span>)}
          </div>
        </div>
        <div style={{ width: 92, flexShrink: 0, textAlign: "right" }}>
          <div style={{ fontFamily: T.mono, fontSize: 18, fontWeight: 600, color: T.ink }}>{(r.similarity_score * 100).toFixed(1)}%</div>
          <div style={{ background: T.border, height: 5, borderRadius: 3, marginTop: 6 }}>
            <div style={{ width: `${Math.min(100, r.similarity_score * 100)}%`, height: 5, borderRadius: 3, background: T.accent }} />
          </div>
          <div style={{ fontFamily: T.sans, fontSize: 11.5, color: T.grayLight, marginTop: 4 }}>similarity</div>
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        {r.shared_phrases?.map((p) => <span key={`p-${p}`} className="pq-chip" title="Shared phrase">“{p}”</span>)}
        {r.shared_concepts?.map((c) => <span key={`c-${c}`} className="pq-chip pq-chip-muted" title="Shared word">{c}</span>)}
      </div>

      
    </li>
  );
}
