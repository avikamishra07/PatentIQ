import React, { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";
import { useSystemStatus } from "../hooks/useSystemStatus.jsx";
import { AXIS_TICK, CHART_TOOLTIP, T } from "../theme.js";
import { fmt } from "../utils/format.js";
import { AsyncBlock, Button, FieldBars, Notice, SectionHeading, StatBlock, StatStrip, SubHeading } from "../components/ui.jsx";
import { LEVEL_META } from "../components/StatusBadge.jsx";

const FEATURES = [
  { id: "classify", title: "Classify an invention", text: "Predict the field of invention for a title or short description." },
  { id: "similarity", title: "Find similar patents", text: "Rank patent titles that overlap with your description, with the reasons for each match." },
  { id: "explorer", title: "Explore the dataset", text: "Search and filter individual patent records by title, field, office, status and year." },
  { id: "reports", title: "Generate a report", text: "Combine the classifier with registry statistics into a downloadable summary." },
];

export default function Dashboard({ navigate }) {
  const ds = useAsync(() => api.datasetStats(), []);
  const metrics = useAsync((s) => api.modelMetrics(s), []);
  const insights = useAsync((s) => api.insights(s), []);
  const sys = useSystemStatus();
  const [showAllFields, setShowAllFields] = useState(false);

  const yearly = useMemo(() => {
    const by = ds.data?.by_publication_year;
    if (!by) return [];
    return Object.entries(by).map(([year, v]) => ({ year, Published: v.Published || 0, Granted: v.Granted || 0 }));
  }, [ds.data]);

  const meta = LEVEL_META[sys.level];

  return (
    <div style={{ maxWidth: 1000 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16, marginBottom: 32 }}>
        <div>
          <h1 style={{ fontFamily: T.sans, fontSize: 24, fontWeight: 700, color: T.ink, margin: "0 0 6px", letterSpacing: "-0.01em" }}>
            Innovation Intelligence &amp; Prior-Art Analysis
          </h1>
          <p style={{ fontFamily: T.sans, fontSize: 14.5, color: T.gray, margin: 0, maxWidth: 560, lineHeight: 1.55 }}>
            Explore existing inventions, research, and technology trends across India&apos;s patent registries.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button variant="secondary" onClick={() => navigate("similarity")}>Find similar patents</Button>
          <Button onClick={() => navigate("classify")}>+ New analysis</Button>
        </div>
      </div>

      <AsyncBlock
        state={ds}
        loadingLabel="Loading dataset statistics…"
        loadingHint="The first request after the backend starts loads the full combined dataset (about 751,000 records), which can take a minute."
        errorTitle="Dataset statistics are unavailable"
      >
        {(d) => (
          <>
            <StatStrip>
              <StatBlock value={fmt(d.total_records)} label="Patent records" />
              <StatBlock value={fmt(d.by_status?.Published)} label="Published applications" />
              <StatBlock value={fmt(d.by_status?.Granted)} label="Granted patents" />
              <StatBlock value={d.publication_year_range ? `${d.publication_year_range[0]}–${d.publication_year_range[1]}` : "—"} label="Publication years" />
              <StatBlock value={metrics.data?.classes?.length ?? "—"} label="Classifier field classes" />
            </StatStrip>

            <div className="pq-grid-2" style={{ marginBottom: 40 }}>
              <div>
                <SubHeading source={`Combined dataset · ${Object.keys(d.by_field).length} field values`}>Classification distribution</SubHeading>
                <FieldBars dist={d.by_field} limit={showAllFields ? 100 : 8} />
                {Object.keys(d.by_field).length > 8 && (
                  <button className="pq-linkbtn" style={{ marginTop: 14 }} onClick={() => setShowAllFields((v) => !v)}>
                    {showAllFields ? "Show top 8 only" : `Show all ${Object.keys(d.by_field).length} fields`}
                  </button>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
                <div>
                  <SubHeading source="Combined dataset">Records by registry office</SubHeading>
                  <FieldBars dist={d.by_office} format={(x) => x} />
                </div>
                <div>
                  <SubHeading source="Combined dataset">Records by status</SubHeading>
                  <FieldBars dist={d.by_status} format={(x) => x} />
                </div>
              </div>
            </div>

            <div style={{ marginBottom: 40 }}>
              <SubHeading source="Combined dataset · by publication year">Records per year</SubHeading>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={yearly} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                    <CartesianGrid stroke={T.border} vertical={false} />
                    <XAxis dataKey="year" tick={AXIS_TICK} axisLine={{ stroke: T.border }} tickLine={false} />
                    <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
                    <Tooltip {...CHART_TOOLTIP} formatter={(v) => fmt(v)} />
                    <Legend wrapperStyle={{ fontFamily: T.sans, fontSize: 12 }} />
                    <Bar dataKey="Published" stackId="a" fill={T.accent} />
                    <Bar dataKey="Granted" stackId="a" fill={T.navy} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p style={{ fontFamily: T.sans, fontSize: 12.5, color: T.gray, margin: "6px 0 0", lineHeight: 1.5 }}>
                {fmt(d.distinct_application_numbers)} distinct application numbers across {fmt(d.total_records)} records. {d.note}
              </p>
            </div>
          </>
        )}
      </AsyncBlock>

      <div style={{ marginBottom: 40 }}>
        <SectionHeading
          title="Available analytics"
          subtitle="Highlights computed by the analytics endpoints. Open Analytics for the charts and tables behind them."
          actions={<Button variant="secondary" small onClick={() => navigate("analytics")}>Open analytics</Button>}
        />
        <AsyncBlock state={insights} loadingLabel="Loading analytics highlights…" errorTitle="Analytics highlights are unavailable">
          {(d) => (
            <>
              <ul style={{ margin: 0, paddingLeft: 18, fontFamily: T.sans, fontSize: 14, color: T.ink, lineHeight: 1.65, display: "flex", flexDirection: "column", gap: 8 }}>
                {d.insights.map((s) => <li key={s}>{s}</li>)}
              </ul>
              <p style={{ fontFamily: T.sans, fontSize: 12, color: T.grayLight, margin: "10px 0 0" }}>
                Source: registry snapshot used to train the classifier. Its totals differ from the combined dataset above.
              </p>
            </>
          )}
        </AsyncBlock>
      </div>

      <div style={{ marginBottom: 40 }}>
        <SectionHeading title="Similarity index" />
        <Notice tone={sys.level === "ready" ? "ok" : sys.level === "unavailable" ? "warn" : "info"}>
          <strong>{meta.label}.</strong>{" "}
          {sys.level === "ready" && sys.status && `${fmt(sys.status.indexed_titles)} distinct titles indexed from ${fmt(sys.status.indexed_records)} records.`}
          {sys.level === "building" && "Similarity search will answer once the index has finished building. Everything else works meanwhile."}
          {sys.level === "unavailable" && (sys.error || "Similarity search cannot be used right now.")}
          {sys.level === "checking" && "Checking the backend…"}{" "}
          <button className="pq-linkbtn" onClick={() => navigate("status")}>System status</button>
        </Notice>
      </div>

      <div>
        <SectionHeading title="What you can do here" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 18 }}>
          {FEATURES.map((f) => (
            <button key={f.id} onClick={() => navigate(f.id)} style={{
              textAlign: "left", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8,
              padding: "16px 18px", cursor: "pointer", fontFamily: T.sans,
            }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: T.ink, marginBottom: 5 }}>{f.title}</div>
              <div style={{ fontSize: 13, color: T.gray, lineHeight: 1.5 }}>{f.text}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
