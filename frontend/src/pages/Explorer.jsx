import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";
import { T } from "../theme.js";
import { fieldLabel, fmt } from "../utils/format.js";
import {
  Button, DataTable, EmptyState, ErrorBanner, Field, LoadingBlock, Notice, Pagination, Panel, SectionHeading, Select,
} from "../components/ui.jsx";

const EMPTY = { q: "", field: "", status: "", office: "", application_number: "", publication_number: "", year_from: "", year_to: "", sort: "date_desc", page_size: "20" };

export default function Explorer({ prefill, navigate }) {
  const [draft, setDraft] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [formError, setFormError] = useState(null);

  // Filter options are the real values present in the dataset.
  const stats = useAsync(() => api.datasetStats(), []);
  const options = useMemo(() => {
    const d = stats.data;
    if (!d) return null;
    return { field: Object.keys(d.by_field).sort(), status: Object.keys(d.by_status).sort(), office: Object.keys(d.by_office).sort() };
  }, [stats.data]);

  const params = useMemo(() => ({ ...applied, page }), [applied, page]);
  const search = useAsync((s) => api.searchPatents(params, s), [JSON.stringify(params)]);

  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: v }));

  useEffect(() => {
    if (prefill?.q) {
      const next = { ...EMPTY, q: prefill.q.split(/\s+/).slice(0, 10).join(" ") }; // API accepts at most 10 words
      setDraft(next); setApplied(next); setPage(1);
    }
  }, [prefill]);

  const submit = (e) => {
    e?.preventDefault();
    if (draft.year_from !== "" && draft.year_to !== "" && Number(draft.year_from) > Number(draft.year_to)) {
      setFormError("“From year” must not be later than “To year”."); return;
    }
    if (draft.q.trim().split(/\s+/).filter(Boolean).length > 10) {
      setFormError("Use at most 10 words in the title search."); return;
    }
    setFormError(null); setApplied(draft); setPage(1);
  };
  const clear = () => { setDraft(EMPTY); setApplied(EMPTY); setPage(1); setFormError(null); };

  const data = search.data;
  const columns = [
    { key: "title", label: "Title", render: (r) => <span style={{ fontWeight: 500, overflowWrap: "anywhere" }}>{r.title || "—"}</span> },
    { key: "application_number", label: "Application no.", render: (r) => <span style={{ fontFamily: T.mono, fontSize: 12.5 }}>{r.application_number}</span> },
    { key: "publication_number", label: "Publication no.", render: (r) => <span style={{ fontFamily: T.mono, fontSize: 12.5 }}>{r.publication_number}</span> },
    { key: "publication_date", label: "Published", render: (r) => <span style={{ fontFamily: T.mono, fontSize: 12.5, whiteSpace: "nowrap" }}>{r.publication_date || "—"}</span> },
    { key: "office", label: "Office" },
    { key: "field", label: "Field", render: (r) => fieldLabel(r.field) },
    { key: "status", label: "Status" },
    {
      key: "actions", label: "",
      render: (r) => (
        <div style={{ display: "flex", gap: 6 }}>
          <Button variant="secondary" small onClick={() => navigate("similarity", { text: r.title })} disabled={!r.title}>Similar</Button>
          <Button variant="secondary" small onClick={() => navigate("classify", { text: r.title })} disabled={!r.title}>Classify</Button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1180 }}>
      <SectionHeading
        title="Dataset explorer"
        subtitle="Search and filter individual patent records from the combined registry dataset. All filters are combined; title words must all appear."
      />

      <form onSubmit={submit}>
        <Panel>
          <div className="pq-form-grid">
            <Field label="Title words" htmlFor="ex-q" hint="Up to 10 words, all must match">
              <input id="ex-q" className="pq-input" value={draft.q} onChange={(e) => set("q")(e.target.value)} maxLength={200} placeholder="e.g. solar pump" />
            </Field>
            <Field label="Field" htmlFor="ex-field">
              <Select id="ex-field" value={draft.field} onChange={set("field")} options={options?.field || []} disabled={!options} format={fieldLabel} />
            </Field>
            <Field label="Status" htmlFor="ex-status">
              <Select id="ex-status" value={draft.status} onChange={set("status")} options={options?.status || []} disabled={!options} />
            </Field>
            <Field label="Patent office" htmlFor="ex-office">
              <Select id="ex-office" value={draft.office} onChange={set("office")} options={options?.office || []} disabled={!options} />
            </Field>
            <Field label="From year" htmlFor="ex-yf" hint="Publication year">
              <input id="ex-yf" className="pq-input" type="number" min={1800} max={2200} placeholder="Any" value={draft.year_from} onChange={(e) => set("year_from")(e.target.value)} />
            </Field>
            <Field label="To year" htmlFor="ex-yt">
              <input id="ex-yt" className="pq-input" type="number" min={1800} max={2200} placeholder="Any" value={draft.year_to} onChange={(e) => set("year_to")(e.target.value)} />
            </Field>
          </div>

          <details style={{ marginTop: 16 }}>
            <summary className="pq-linkbtn" style={{ display: "inline-block" }}>More filters and sorting</summary>
            <div className="pq-form-grid" style={{ marginTop: 14 }}>
              <Field label="Application number" htmlFor="ex-app" hint="Exact match">
                <input id="ex-app" className="pq-input" value={draft.application_number} onChange={(e) => set("application_number")(e.target.value)} maxLength={100} />
              </Field>
              <Field label="Publication number" htmlFor="ex-pub" hint="Exact match, e.g. 14/2026">
                <input id="ex-pub" className="pq-input" value={draft.publication_number} onChange={(e) => set("publication_number")(e.target.value)} maxLength={100} />
              </Field>
              <Field label="Sort by" htmlFor="ex-sort">
                <select id="ex-sort" className="pq-input" value={draft.sort} onChange={(e) => set("sort")(e.target.value)}>
                  <option value="date_desc">Newest first</option>
                  <option value="date_asc">Oldest first</option>
                </select>
              </Field>
              <Field label="Rows per page" htmlFor="ex-ps">
                <select id="ex-ps" className="pq-input" value={draft.page_size} onChange={(e) => set("page_size")(e.target.value)}>
                  {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </Field>
            </div>
          </details>

          {formError && <div style={{ marginTop: 14 }}><Notice tone="warn">{formError}</Notice></div>}
          {stats.error && !options && <div style={{ marginTop: 14 }}><ErrorBanner error={stats.error} title="Filter options could not be loaded" onRetry={stats.reload} /></div>}

          <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button type="submit" disabled={search.loading}>Search records</Button>
            <Button variant="ghost" onClick={clear}>Clear filters</Button>
          </div>
        </Panel>
      </form>

      <div style={{ marginTop: 26 }} aria-live="polite">
        {search.loading && !data && (
          <LoadingBlock label="Searching the dataset…" hint="The first request after the backend starts loads the full dataset and can take a minute." />
        )}
        {search.error && <ErrorBanner error={search.error} title="The dataset search failed" onRetry={search.reload} />}

        {data && (
          <div style={{ opacity: search.loading ? 0.55 : 1, transition: "opacity 0.15s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12, fontFamily: T.sans, fontSize: 13.5, color: T.gray }}>
              <span>
                <strong style={{ color: T.ink, fontFamily: T.mono }}>{fmt(data.total)}</strong> {data.total === 1 ? "record" : "records"}
                {Object.keys(data.filters || {}).length > 0 ? " match" : " in the dataset"}
              </span>
              {data.total > 0 && <span>Showing {fmt((data.page - 1) * data.page_size + 1)}–{fmt(Math.min(data.total, data.page * data.page_size))}</span>}
            </div>

            {data.results.length === 0 ? (
              <EmptyState title={data.total === 0 ? "No patents match these filters" : "This page is past the last result"}>
                {data.total === 0 ? "Remove a filter or use fewer title words." : `There are ${fmt(data.total_pages)} pages.`}
                {data.total > 0 && <div style={{ marginTop: 12 }}><Button variant="secondary" small onClick={() => setPage(data.total_pages)}>Go to last page</Button></div>}
              </EmptyState>
            ) : (
              <>
                <DataTable columns={columns} rows={data.results} rowKey={(r, i) => `${r.application_number}-${r.publication_number}-${r.status}-${i}`} />
                <div style={{ marginTop: 16 }}>
                  <Pagination page={data.page} totalPages={data.total_pages} onPage={setPage} disabled={search.loading} />
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
