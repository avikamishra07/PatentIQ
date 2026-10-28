import React, { useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";
import { AXIS_TICK, CHART_TOOLTIP, T } from "../theme.js";
import { fieldLabel, fmt, sentenceCase } from "../utils/format.js";
import {
  AsyncBlock, DataTable, Notice, SectionHeading, StatBlock, StatStrip, SubHeading, Tabs,
} from "../components/ui.jsx";

const TABS = [
  { id: "trends", label: "Filing trends" },
  { id: "grant", label: "Grant activity" },
  { id: "types", label: "Application types" },
  { id: "cities", label: "Cities and fields" },
  { id: "model", label: "Classifier performance" },
];
const SNAPSHOT = "Source: registry snapshot used to train the classifier (GET /stats)";

const kfmt = (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v);

export default function Analytics() {
  const [tab, setTab] = useState("trends");
  return (
    <div style={{ maxWidth: 1000 }}>
      <SectionHeading
        title="Analytics"
        subtitle="Filing trends, grant activity, filing types and classifier quality, from the backend's analytics endpoints."
      />
      <Notice tone="info" style={{ marginBottom: 24 }}>
        These figures come from the registry snapshot the classifier was trained on, so totals differ from the combined dataset shown on the Dashboard and in the Dataset explorer.
      </Notice>
      <Tabs tabs={TABS} value={tab} onChange={setTab} label="Analytics sections" />
      {tab === "trends" && <Trends />}
      {tab === "grant" && <GrantActivity />}
      {tab === "types" && <ApplicationTypes />}
      {tab === "cities" && <CitiesFields />}
      {tab === "model" && <ModelPerformance />}
    </div>
  );
}

function Trends() {
  const stats = useAsync((s) => api.modelStats(s), []);
  return (
    <AsyncBlock state={stats} loadingLabel="Loading filing trends…" errorTitle="Filing trends are unavailable">
      {(S) => <TrendsBody S={S} />}
    </AsyncBlock>
  );
}

function TrendsBody({ S }) {
  const yearly = useMemo(() => Object.keys(S.yearly_trend_published).sort().map((y) => ({
    year: y, Published: S.yearly_trend_published[y] || 0, Granted: S.yearly_trend_granted[y] || 0,
  })), [S]);
  const byField = useMemo(() => Object.keys(S.field_distribution_published).map((f) => ({
    field: fieldLabel(f), Published: S.field_distribution_published[f] || 0, Granted: S.field_distribution_granted[f] || 0,
  })).sort((a, b) => b.Published - a.Published), [S]);
  return (
    <>
      <StatStrip>
        <StatBlock value={fmt(S.total_published)} label="Published applications" />
        <StatBlock value={fmt(S.total_granted)} label="Granted patents" />
        <StatBlock value={`${S.year_range[0]}–${S.year_range[1]}`} label="Filing years covered" />
      </StatStrip>

      <div style={{ marginBottom: 40 }}>
        <SubHeading source={`${SNAPSHOT} · ${yearly[0]?.year}–${yearly[yearly.length - 1]?.year}`}>Filing trend by year</SubHeading>
        <div style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer>
            <LineChart data={yearly} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid stroke={T.border} vertical={false} />
              <XAxis dataKey="year" tick={AXIS_TICK} axisLine={{ stroke: T.border }} tickLine={false} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={kfmt} />
              <Tooltip {...CHART_TOOLTIP} formatter={(v) => fmt(v)} />
              <Legend wrapperStyle={{ fontFamily: T.sans, fontSize: 12 }} />
              <Line type="monotone" dataKey="Published" stroke={T.accent} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Granted" stroke={T.navy} strokeWidth={2} dot={false} strokeDasharray="4 3" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <SubHeading source={SNAPSHOT}>Published and granted by field</SubHeading>
        <div style={{ width: "100%", height: Math.max(320, byField.length * 30) }}>
          <ResponsiveContainer>
            <BarChart data={byField} layout="vertical" margin={{ top: 4, right: 16, left: 20, bottom: 0 }}>
              <CartesianGrid stroke={T.border} horizontal={false} />
              <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={kfmt} />
              <YAxis type="category" dataKey="field" width={110} tick={{ ...AXIS_TICK, fill: T.ink }} axisLine={false} tickLine={false} />
              <Tooltip {...CHART_TOOLTIP} formatter={(v) => fmt(v)} />
              <Legend wrapperStyle={{ fontFamily: T.sans, fontSize: 12 }} />
              <Bar dataKey="Published" fill={T.accent} radius={[0, 3, 3, 0]} />
              <Bar dataKey="Granted" fill={T.navy} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
}

function GrantActivity() {
  const gr = useAsync((s) => api.grantRate(s), []);
  return (
    <AsyncBlock state={gr} loadingLabel="Loading grant activity…" errorTitle="Grant activity is unavailable">
      {(d) => (
        <>
          <StatStrip>
            <StatBlock value={`${d.overall_grant_rate_pct}%`} label="Granted-to-published ratio, overall" />
          </StatStrip>
          <Notice tone="warn" style={{ marginBottom: 28 }}>{d.note}</Notice>

          <div style={{ marginBottom: 40 }}>
            <SubHeading source="GET /analytics/grant-rate · granted ÷ published, by field">Grant activity by field</SubHeading>
            <div style={{ width: "100%", height: Math.max(320, d.by_field.length * 28) }}>
              <ResponsiveContainer>
                <BarChart data={d.by_field.map((r) => ({ ...r, label: fieldLabel(r.field) }))} layout="vertical" margin={{ top: 4, right: 24, left: 20, bottom: 0 }}>
                  <CartesianGrid stroke={T.border} horizontal={false} />
                  <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} unit="%" domain={[0, (m) => Math.ceil(m / 25) * 25]} ticks={[0, 25, 50, 75, 100, 125, 150].filter((x) => x <= Math.ceil(Math.max(...d.by_field.map((r) => r.grant_rate_pct)) / 25) * 25)} />
                  <YAxis type="category" dataKey="label" width={110} tick={{ ...AXIS_TICK, fill: T.ink }} axisLine={false} tickLine={false} />
                  <Tooltip {...CHART_TOOLTIP} formatter={(v) => `${v}%`} />
                  <ReferenceLine x={100} stroke={T.grayLight} strokeDasharray="4 3" />
                  <Bar dataKey="grant_rate_pct" name="Granted ÷ published" radius={[0, 3, 3, 0]}>
                    {d.by_field.map((r) => <Cell key={r.field} fill={r.grant_rate_pct > 100 ? T.amber : T.accent} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p style={{ fontFamily: T.sans, fontSize: 12, color: T.grayLight, margin: "4px 0 16px" }}>Amber bars exceed 100%; see the note above.</p>
            <DataTable
              rowKey={(r) => r.field}
              rows={d.by_field}
              columns={[
                { key: "field", label: "Field", render: (r) => fieldLabel(r.field) },
                { key: "published", label: "Published", num: true, render: (r) => fmt(r.published) },
                { key: "granted", label: "Granted", num: true, render: (r) => fmt(r.granted) },
                { key: "grant_rate_pct", label: "Ratio", num: true, render: (r) => `${r.grant_rate_pct}%` },
              ]}
            />
          </div>

          <div>
            <SubHeading source="GET /analytics/grant-rate · granted ÷ published, by registry city">Grant activity by city</SubHeading>
            <DataTable
              rowKey={(r) => r.city}
              rows={d.by_city}
              columns={[
                { key: "city", label: "City" },
                { key: "published", label: "Published", num: true, render: (r) => fmt(r.published) },
                { key: "granted", label: "Granted", num: true, render: (r) => fmt(r.granted) },
                { key: "grant_rate_pct", label: "Ratio", num: true, render: (r) => `${r.grant_rate_pct}%` },
              ]}
            />
          </div>
        </>
      )}
    </AsyncBlock>
  );
}

function ApplicationTypes() {
  const at = useAsync((s) => api.applicationTypes(s), []);
  return (
    <AsyncBlock state={at} loadingLabel="Loading application types…" errorTitle="Application types are unavailable">
      {(d) => (
        <>
          <SubHeading source={`GET /analytics/application-types · ${fmt(d.total_published)} published applications`}>Filing-type mix</SubHeading>
          <div style={{ width: "100%", height: Math.max(260, d.types.length * 34) }}>
            <ResponsiveContainer>
              <BarChart data={d.types.map((t) => ({ ...t, label: sentenceCase(t.type) }))} layout="vertical" margin={{ top: 4, right: 24, left: 10, bottom: 0 }}>
                <CartesianGrid stroke={T.border} horizontal={false} />
                <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} unit="%" />
                <YAxis type="category" dataKey="label" width={250} tick={{ ...AXIS_TICK, fill: T.ink, fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip {...CHART_TOOLTIP} formatter={(v, _n, p) => [`${v}% (${fmt(p.payload.count)})`, "Share"]} />
                <Bar dataKey="share_pct" fill={T.accent} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ marginTop: 20 }}>
            <DataTable
              rowKey={(r) => r.type}
              rows={d.types}
              columns={[
                { key: "type", label: "Type", render: (r) => <span style={{ fontWeight: 500 }}>{sentenceCase(r.type)}</span> },
                { key: "count", label: "Applications", num: true, render: (r) => fmt(r.count) },
                { key: "share_pct", label: "Share", num: true, render: (r) => `${r.share_pct}%` },
                { key: "description", label: "What it means" },
              ]}
            />
          </div>
        </>
      )}
    </AsyncBlock>
  );
}

function CitiesFields() {
  const stats = useAsync((s) => api.modelStats(s), []);
  return (
    <AsyncBlock state={stats} loadingLabel="Loading city breakdown…" errorTitle="City breakdown is unavailable">
      {(S) => <CitiesBody S={S} />}
    </AsyncBlock>
  );
}

function CitiesBody({ S }) {
  const cities = Object.keys(S.city_field_breakdown_published).sort((a, b) => (S.city_totals_published[b] || 0) - (S.city_totals_published[a] || 0));
  const fields = Object.keys(S.field_distribution_published).sort((a, b) => S.field_distribution_published[b] - S.field_distribution_published[a]);
  const cityChart = cities.map((c) => ({ city: c, Published: S.city_totals_published[c] || 0, Granted: S.city_totals_granted[c] || 0 }));
  const shade = (count, city) => {
    const total = S.city_totals_published[city] || 1;
    const share = count / total;                      // share of that city's published filings
    return `rgba(138,106,40,${Math.min(0.5, share * 1.6).toFixed(3)})`;
  };
  return (
    <>
      <div style={{ marginBottom: 40 }}>
        <SubHeading source={SNAPSHOT}>Filings by registry city</SubHeading>
        <div style={{ width: "100%", height: 240 }}>
          <ResponsiveContainer>
            <BarChart data={cityChart} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid stroke={T.border} vertical={false} />
              <XAxis dataKey="city" tick={{ ...AXIS_TICK, fontSize: 12, fill: T.ink }} axisLine={{ stroke: T.border }} tickLine={false} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={kfmt} />
              <Tooltip {...CHART_TOOLTIP} formatter={(v) => fmt(v)} />
              <Legend wrapperStyle={{ fontFamily: T.sans, fontSize: 12 }} />
              <Bar dataKey="Published" fill={T.accent} radius={[3, 3, 0, 0]} />
              <Bar dataKey="Granted" fill={T.navy} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <SubHeading source={`${SNAPSHOT} · published applications. Darker cells are a larger share of that city's filings.`}>Fields by city</SubHeading>
      <div className="pq-table-wrap">
        <table className="pq-table">
          <thead>
            <tr><th>Field</th>{cities.map((c) => <th key={c} className="num">{c}</th>)}<th className="num">All cities</th></tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f}>
                <td style={{ fontWeight: 500 }}>{fieldLabel(f)}</td>
                {cities.map((c) => {
                  const n = S.city_field_breakdown_published[c]?.[f] || 0;
                  return <td key={c} className="num" style={{ background: shade(n, c) }}>{fmt(n)}</td>;
                })}
                <td className="num">{fmt(S.field_distribution_published[f])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ModelPerformance() {
  const m = useAsync((s) => api.modelMetrics(s), []);
  return (
    <AsyncBlock state={m} loadingLabel="Loading classifier metrics…" errorTitle="Classifier metrics are unavailable">
      {(d) => {
        const rows = Object.entries(d.per_class).map(([field, v]) => ({ field, ...v })).sort((a, b) => b["f1-score"] - a["f1-score"]);
        return (
          <>
            <StatStrip>
              <StatBlock value={`${(d.accuracy * 100).toFixed(1)}%`} label="Accuracy on held-out data" />
              <StatBlock value={d.f1_macro.toFixed(3)} label="Macro F1" />
              <StatBlock value={d.f1_weighted.toFixed(3)} label="Weighted F1" />
              <StatBlock value={fmt(d.n_train)} label="Training records" />
              <StatBlock value={fmt(d.n_test)} label="Test records" />
            </StatStrip>
            <p style={{ fontFamily: T.sans, fontSize: 13.5, color: T.gray, margin: "-12px 0 24px", lineHeight: 1.55 }}>Model: {d.model}</p>
            <SubHeading source="GET /metrics · per-class results on the test set, best F1 first">Per-field quality</SubHeading>
            <DataTable
              rowKey={(r) => r.field}
              rows={rows}
              columns={[
                { key: "field", label: "Field", render: (r) => fieldLabel(r.field) },
                { key: "precision", label: "Precision", num: true, render: (r) => r.precision.toFixed(2) },
                { key: "recall", label: "Recall", num: true, render: (r) => r.recall.toFixed(2) },
                {
                  key: "f1", label: "F1", num: true, width: 180,
                  render: (r) => (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                      <div style={{ background: T.border, height: 5, borderRadius: 3, width: 80 }}>
                        <div style={{ width: `${r["f1-score"] * 100}%`, height: 5, borderRadius: 3, background: r["f1-score"] >= 0.5 ? T.accent : T.borderStrong }} />
                      </div>
                      {r["f1-score"].toFixed(2)}
                    </div>
                  ),
                },
                { key: "support", label: "Test records", num: true, render: (r) => fmt(r.support) },
              ]}
            />
          </>
        );
      }}
    </AsyncBlock>
  );
}
