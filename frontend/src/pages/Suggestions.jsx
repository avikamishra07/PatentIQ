import React, { useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";
import { useSystemStatus } from "../hooks/useSystemStatus.jsx";
import { T } from "../theme.js";
import { fieldLabel, fmt, sleep, strengthTier } from "../utils/format.js";
import { DEFAULT_FORM, MAX_DESCRIPTION, MAX_SUGGESTIONS, buildBody, emptyReason, orDash, pct, validateForm } from "../utils/suggestions.js";
import {
  Button, EmptyState, ErrorBanner, Field, LoadingBlock, Notice, Panel, SectionHeading, Select, StatusPill,
} from "../components/ui.jsx";

const MAX_RETRIES = 40; // ~3 minutes of retries while the shared similarity index builds

export default function Suggestions({ prefill, navigate }) {
  const sys = useSystemStatus();
  const [form, setForm] = useState({ ...DEFAULT_FORM });
  const [phase, setPhase] = useState("idle"); // idle | searching | waiting | done | error
  const [wait, setWait] = useState(null);
  const [formError, setFormError] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const abortRef = useRef(null);

  const filters = useAsync((s) => api.similarityFilters(s), [sys.level], { enabled: sys.level === "ready" });
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const busy = phase === "searching" || phase === "waiting";

  useEffect(() => { if (prefill?.text) setForm((f) => ({ ...f, description: prefill.text.slice(0, MAX_DESCRIPTION) })); }, [prefill]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async () => {
    const problem = validateForm(form);
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
          const res = await api.suggestionsSearch(body, ctrl.signal);
          setResult(res); setPhase("done"); setWait(null);
          return;
        } catch (err) {
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

  const reset = () => { setForm((f) => ({ ...DEFAULT_FORM, description: f.description })); setFormError(null); };
  const opts = filters.data;

  return (
    <div style={{ maxWidth: 960 }}>
      <SectionHeading
        title="Personalized suggestions"
        subtitle="Describe your invention and PatentIQ ranks real patent records from the dataset whose titles overlap with your idea. Change the filters and search again to refine the list."
      />

      {sys.level !== "ready" && (
        <Notice tone={sys.level === "unavailable" ? "warn" : "info"} style={{ marginBottom: 20 }}>
          {sys.level === "unavailable"
            ? <>Suggestions are unavailable: {sys.error} </>
            : <>The search index is {sys.level === "checking" ? "being checked" : "still building"}. You can submit now; the search runs automatically when it is ready. </>}
          <button className="pq-linkbtn" onClick={() => navigate("status")}>System status</button>
        </Notice>
      )}

      <Panel>
        <Field label="Your invention idea or technical description" htmlFor="sg-desc">
          <textarea id="sg-desc" className="pq-input" rows={5} maxLength={MAX_DESCRIPTION} value={form.description}
            onChange={(e) => set("description")(e.target.value)}
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !busy) run(); }}
            placeholder="e.g. a solar powered pump that irrigates fields using soil moisture sensors" />
        </Field>
        <div style={{ fontFamily: T.mono, fontSize: 12, color: T.grayLight, margin: "6px 0 18px" }}>{form.description.length}/{MAX_DESCRIPTION}</div>

        <div className="pq-form-grid">
          <Field label="Field of invention" htmlFor="sg-field" hint={sys.level !== "ready" ? "Options load once the index is ready." : filters.error ? "Options could not be loaded." : undefined}>
            <Select id="sg-field" value={form.field} onChange={set("field")} options={opts?.field || []} disabled={!opts} format={fieldLabel} />
          </Field>
          <Field label="Status" htmlFor="sg-status">
            <Select id="sg-status" value={form.status} onChange={set("status")} options={opts?.status || []} disabled={!opts} />
          </Field>
          <Field label="Patent office" htmlFor="sg-office">
            <Select id="sg-office" value={form.office} onChange={set("office")} options={opts?.office || []} disabled={!opts} />
          </Field>
          <Field label="From year" htmlFor="sg-yf" hint="Publication year">
            <input id="sg-yf" className="pq-input" type="number" min={1800} max={2200} placeholder="Any" value={form.year_from} onChange={(e) => set("year_from")(e.target.value)} />
          </Field>
          <Field label="To year" htmlFor="sg-yt">
            <input id="sg-yt" className="pq-input" type="number" min={1800} max={2200} placeholder="Any" value={form.year_to} onChange={(e) => set("year_to")(e.target.value)} />
          </Field>
          <Field label="Suggestions to show" htmlFor="sg-k" hint={`1–${MAX_SUGGESTIONS}`}>
            <input id="sg-k" className="pq-input" type="number" min={1} max={MAX_SUGGESTIONS} value={form.top_k} onChange={(e) => set("top_k")(e.target.value)} />
          </Field>
          <Field label="Minimum relevance" htmlFor="sg-min" hint="0–1. Lower shows weaker matches.">
            <input id="sg-min" className="pq-input" type="number" min={0} max={1} step={0.01} value={form.min_score} onChange={(e) => set("min_score")(e.target.value)} />
          </Field>
        </div>
        {filters.error && sys.level === "ready" && (
          <div style={{ marginTop: 12 }}><ErrorBanner error={filters.error} title="Could not load filter options" onRetry={filters.reload} /></div>
        )}

        {formError && <div style={{ marginTop: 16 }} role="alert"><Notice tone="warn">{formError}</Notice></div>}

        <div style={{ marginTop: 20, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Button onClick={run} disabled={busy}>{busy ? "Searching…" : result ? "Search again" : "Get suggestions"}</Button>
          {busy && <Button variant="secondary" onClick={() => abortRef.current?.abort()}>Cancel</Button>}
          <Button variant="ghost" onClick={reset} disabled={busy}>Reset filters</Button>
        </div>
        <p style={{ fontFamily: T.sans, fontSize: 12, color: T.grayLight, margin: "12px 0 0" }}>
          Your description and filters are used only for this search and are not saved.
        </p>
      </Panel>

      <div style={{ marginTop: 28 }} aria-live="polite">
        {phase === "searching" && <LoadingBlock label="Finding relevant patents…" />}
        {phase === "waiting" && wait && (
          <LoadingBlock label={`The search index is still building. Retrying in ${wait.left} s…`}
            hint={`Attempt ${wait.attempt} of up to ${MAX_RETRIES}; you can cancel at any time.`} />
        )}
        {phase === "error" && error && (
          <ErrorBanner
            title={error.isIndexBuilding ? "The index is taking longer than expected" : error.isUnavailable ? "Suggestions are unavailable" : error.status === 422 || error.status === 400 ? "This search can't be run" : "The search failed"}
            error={error} onRetry={run}>
            {error.isUnavailable && <div style={{ marginTop: 8 }}><button className="pq-linkbtn" onClick={() => navigate("status")}>Open system status</button></div>}
          </ErrorBanner>
        )}
        {result && !busy && phase !== "error" && <Results data={result} navigate={navigate} />}
        {!result && phase === "idle" && <EmptyState title="No suggestions yet">Enter an idea above to see ranked patents with the reasons they were chosen.</EmptyState>}
      </div>

      <InnovationAssistant description={form.description} patentMatches={result?.suggestions || []} />
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
          {data.returned} {data.returned === 1 ? "suggestion" : "suggestions"}
        </h3>
        <span style={{ fontFamily: T.sans, fontSize: 12.5, color: T.gray }}>
          {fmt(data.titles_with_any_overlap)} titles share at least one term · {data.elapsed_ms} ms{data.cache_hit ? " · cached" : ""}
        </span>
      </div>
      {q.key_terms?.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <span style={{ fontFamily: T.sans, fontSize: 12.5, color: T.gray, marginRight: 8 }}>Key terms from your description:</span>
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
      {data.scan_truncated && <Notice tone="warn" style={{ marginBottom: 10 }}>With these filters only the best-ranked 20,000 titles were examined, so some matches may be missing.</Notice>}
      {data.note && <Notice tone="info" style={{ marginBottom: 10 }}>{data.note}</Notice>}

      {data.suggestions.length === 0 ? (
        <EmptyState title={emptyReason(data)}>Try more specific words, lower the minimum relevance, or loosen the filters, then search again.</EmptyState>
      ) : (
        <ol style={{ listStyle: "none", margin: "16px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {data.suggestions.map((s, i) => <SuggestionCard key={`${s.application_number}-${s.publication_number}-${i}`} s={s} navigate={navigate} />)}
        </ol>
      )}
      <p style={{ fontFamily: T.sans, fontSize: 12.5, color: T.gray, marginTop: 20 }}>
        Method: {data.method.type}. Ranking: {data.method.ranking}. Index: {fmt(data.method.indexed_titles)} distinct titles from {fmt(data.method.indexed_records)} records.
      </p>
    </div>
  );
}

function SuggestionCard({ s, navigate }) {
  const meta = [
    ["Publication no.", s.publication_number], ["Application no.", s.application_number],
    ["Published", s.publication_date], ["Filed", s.filing_date], ["Office", s.office],
  ];
  return (
    <li style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: "16px 18px" }}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <div style={{ fontFamily: T.mono, fontSize: 13, color: T.grayLight, minWidth: 26, paddingTop: 2 }}>#{s.rank}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: T.sans, fontSize: 15, fontWeight: 600, color: T.ink, lineHeight: 1.45, overflowWrap: "anywhere" }}>{s.title || "Untitled record"}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "8px 0" }}>
            {s.relevance_label && <StatusPill tier={strengthTier(s.relevance_label)} label={s.relevance_label} />}
            <span className="pq-chip pq-chip-muted" style={{ margin: 0 }} title="Field of invention">{s.field ? fieldLabel(s.field) : "Field not specified"}</span>
            <span className="pq-chip pq-chip-muted" style={{ margin: 0 }}>{s.status || "Status not specified"}</span>
            {s.records_with_this_title > 1 && <span style={{ fontFamily: T.sans, fontSize: 12, color: T.gray }}>{fmt(s.records_with_this_title)} records share this title</span>}
          </div>
          <div style={{ fontFamily: T.sans, fontSize: 12.5, color: T.gray, display: "flex", flexWrap: "wrap", gap: "2px 18px" }}>
            {meta.map(([k, v]) => <span key={k}>{k} <span style={{ fontFamily: T.mono, color: T.ink }}>{orDash(v)}</span></span>)}
          </div>
        </div>
        <div style={{ width: 92, flexShrink: 0, textAlign: "right" }}>
          <div style={{ fontFamily: T.mono, fontSize: 18, fontWeight: 600, color: T.ink }}>{pct(s.relevance_score)}</div>
          <div style={{ background: T.border, height: 5, borderRadius: 3, marginTop: 6 }}>
            <div style={{ width: `${Math.min(100, (s.relevance_score || 0) * 100)}%`, height: 5, borderRadius: 3, background: T.accent }} />
          </div>
          <div style={{ fontFamily: T.sans, fontSize: 11.5, color: T.grayLight, marginTop: 4 }}>relevance</div>
        </div>
      </div>

      {s.reasons?.length > 0 && (
        <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontFamily: T.sans, fontSize: 13, color: T.ink, lineHeight: 1.6 }}>
          {s.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
      <div style={{ marginTop: 8 }}>
        {s.matched_phrases?.map((p) => <span key={`p-${p}`} className="pq-chip" title="Shared phrase">“{p}”</span>)}
        {s.matched_words?.map((c) => <span key={`c-${c}`} className="pq-chip pq-chip-muted" title="Shared word">{c}</span>)}
      </div>

      <details style={{ marginTop: 6 }}>
        <summary className="pq-linkbtn" style={{ display: "inline-block" }}>Score details</summary>
        {s.explanation && <p style={{ fontFamily: T.sans, fontSize: 13.5, color: T.ink, lineHeight: 1.6, margin: "10px 0" }}>{s.explanation}</p>}
        {s.score_breakdown?.length > 0 && (
          <div className="pq-table-wrap">
            <table className="pq-table">
              <thead><tr><th>Term</th><th>Type</th><th className="num">Contribution</th><th className="num">Share of score</th></tr></thead>
              <tbody>
                {s.score_breakdown.map((b) => (
                  <tr key={`${b.kind}-${b.term}`}><td>{b.term}</td><td>{b.kind}</td><td className="num">{b.contribution}</td><td className="num">{Math.round(b.share_of_score * 100)}%</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {s.title && <Button variant="secondary" small onClick={() => navigate("explorer", { q: s.title })}>Find in dataset explorer</Button>}
          {s.title && <Button variant="secondary" small onClick={() => navigate("classify", { text: s.title })}>Classify this title</Button>}
        </div>
      </details>
    </li>
  );
}


function InnovationAssistant({ description, patentMatches }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const [status, setStatus] = useState({ loading: true, available: false, model: "openai/gpt-oss-20b", setup_hint: "" });
  const endRef = useRef(null);
  const lastIdeaRef = useRef("");

  const refreshStatus = async () => {
    setStatus((s) => ({ ...s, loading: true }));
    try {
      const next = await api.innovationChatStatus();
      setStatus({ ...next, loading: false });
    } catch {
      setStatus({ loading: false, available: false, model: "openai/gpt-oss-20b", setup_hint: "Create a GroqCloud API key and configure GROQ_API_KEY in backend/.env, then restart the backend." });
    }
  };

  useEffect(() => { refreshStatus(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, chatBusy]);

  const newChat = () => {
    setMessages([]);
    setDraft("");
    setChatError("");
    lastIdeaRef.current = "";
  };

  const send = async (overrideText) => {
    const text = (overrideText ?? draft).trim();
    const idea = description.trim();
    if (!idea) {
      setChatError("Enter your invention idea in the description box above before chatting.");
      return;
    }
    if (!text || chatBusy) return;

    const sameIdea = lastIdeaRef.current === idea;
    const historyBase = sameIdea ? messages : [];
    const priorHistory = historyBase.slice(-8).map(({ role, content }) => ({ role, content }));
    const userMessage = { role: "user", content: text };
    setMessages([...historyBase, userMessage]);
    setDraft("");
    setChatError("");
    setChatBusy(true);
    lastIdeaRef.current = idea;

    const context = (patentMatches || []).slice(0, 5).filter((p) => p?.title).map((p) => ({
      title: p.title,
      publication_number: p.publication_number || null,
      field: p.field || null,
      status: p.status || null,
      relevance_score: typeof p.relevance_score === "number" ? p.relevance_score : null,
      reasons: Array.isArray(p.reasons) ? p.reasons.slice(0, 4) : [],
    }));

    try {
      const response = await api.innovationChat({
        description: idea,
        message: text,
        history: priorHistory,
        patent_matches: context,
      });
      setMessages((current) => [...current, { role: "assistant", content: response.answer, model: response.model }]);
    } catch (err) {
      setChatError(err?.message || "The AI assistant could not answer. Check the backend configuration and current Groq quota.");
    } finally {
      setChatBusy(false);
    }
  };

  const quickPrompts = [
    "Suggest three technical ways to improve my idea.",
    "Which parts of my idea should I compare with the matching patents?",
    "What prototype experiment should I try first?",
  ];

  return (
    <Panel style={{ marginTop: 30, padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "20px 22px", borderBottom: `1px solid ${T.border}`, display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 5 }}>
            <span aria-hidden="true" style={{ display: "inline-flex", width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 9, background: T.accentSoft || "#e8f3ef", color: T.accent, fontSize: 17 }}>✦</span>
            <h3 style={{ fontFamily: T.sans, fontSize: 18, fontWeight: 650, color: T.ink, margin: 0 }}>Innovation Assistant</h3>
          </div>
          <p style={{ fontFamily: T.sans, color: T.gray, fontSize: 13, lineHeight: 1.5, margin: 0, maxWidth: 620 }}>
            Discuss your invention, explore improvements, and ask follow-up questions. The assistant can use your current patent matches as context.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="pq-chip pq-chip-muted" style={{ margin: 0 }}>{status.available ? `GroqCloud · ${status.model}` : "AI not configured"}</span>
          <Button variant="secondary" small onClick={newChat} disabled={chatBusy}>New chat</Button>
        </div>
      </div>

      {!status.available && (
        <div style={{ padding: "14px 22px 0" }}>
          <Notice tone="info">
            This assistant uses GroqCloud through the PatentIQ backend. A free-tier API key may be available, subject to Groq’s current limits. {status.loading ? "Checking configuration…" : "To enable it, set GROQ_API_KEY in backend/.env and restart the backend."}
            {!status.loading && <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" className="pq-linkbtn" onClick={refreshStatus}>Check again</button>
              {status.setup_hint && <span style={{ fontSize: 12 }}>{status.setup_hint}</span>}
            </div>}
          </Notice>
        </div>
      )}

      <div style={{ padding: "18px 22px 10px" }}>
        {messages.length === 0 ? (
          <div style={{ padding: "18px 14px", background: T.surfaceAlt || "#f7f8fa", border: `1px solid ${T.border}`, borderRadius: 10 }}>
            <p style={{ fontFamily: T.sans, fontSize: 14, color: T.ink, margin: "0 0 6px", fontWeight: 600 }}>What would you like to explore?</p>
            <p style={{ fontFamily: T.sans, fontSize: 13, color: T.gray, margin: "0 0 14px", lineHeight: 1.5 }}>Start with your idea above, then choose a prompt or ask your own question.</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {quickPrompts.map((prompt) => <button key={prompt} type="button" className="pq-chip" style={{ cursor: "pointer", textAlign: "left", whiteSpace: "normal" }} onClick={() => setDraft(prompt)}>{prompt}</button>)}
            </div>
          </div>
        ) : (
          <div aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: 480, overflowY: "auto", padding: "2px 4px 12px" }}>
            {messages.map((item, index) => (
              <div key={`${index}-${item.role}`} style={{ display: "flex", justifyContent: item.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{ maxWidth: "92%", padding: "11px 14px", borderRadius: 12, background: item.role === "user" ? (T.accent || "#225c50") : (T.surfaceAlt || "#f7f8fa"), color: item.role === "user" ? "#ffffff" : T.ink, border: item.role === "assistant" ? `1px solid ${T.border}` : "none", fontFamily: T.sans, fontSize: 13.5, lineHeight: 1.65, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  {item.content}
                  {item.role === "assistant" && item.model && <div style={{ fontSize: 10.5, color: T.gray, marginTop: 7 }}>Generated by GroqCloud · {item.model}</div>}
                </div>
              </div>
            ))}
            {chatBusy && <div style={{ fontFamily: T.sans, color: T.gray, fontSize: 13, padding: 8 }}>Thinking… waiting for the AI service.</div>}
            <div ref={endRef} />
          </div>
        )}
        {chatError && <div role="alert" style={{ marginTop: 10 }}><Notice tone="warn">{chatError}</Notice></div>}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); send(); }} style={{ padding: "12px 22px 20px", borderTop: `1px solid ${T.border}` }}>
        <label htmlFor="innovation-chat-message" style={{ display: "block", fontFamily: T.sans, fontSize: 12, color: T.gray, marginBottom: 7 }}>Your message</label>
        <div style={{ display: "flex", gap: 9, alignItems: "flex-end" }}>
          <textarea id="innovation-chat-message" className="pq-input" rows={2} maxLength={1500} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask about an improvement, a patent match, or a prototype idea…" disabled={chatBusy} style={{ flex: 1, minHeight: 62, resize: "vertical" }} />
          <Button type="submit" disabled={chatBusy || !draft.trim()}>{chatBusy ? "Thinking…" : "Send"}</Button>
        </div>
        <p style={{ fontFamily: T.sans, fontSize: 11.5, color: T.grayLight, margin: "9px 0 0", lineHeight: 1.5 }}>
          Chat history stays in this page session and is not saved by PatentIQ. Messages and the patent context you provide are sent to GroqCloud to generate replies; avoid entering confidential or unpublished invention details unless you have reviewed the provider’s data terms. AI suggestions are exploratory and do not establish novelty or patentability. <a href="https://console.groq.com/docs/your-data" target="_blank" rel="noreferrer" style={{ color: T.accent }}>Review Groq data handling</a>.
        </p>
      </form>
    </Panel>
  );
}
