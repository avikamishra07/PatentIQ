import React, { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { T } from "../theme.js";
import { fieldLabel, fmt, downloadFile, sentenceCase, slugify, confidenceTier } from "../utils/format.js";
import { buildReportMarkdown } from "../utils/report.js";
import { Button, ErrorBanner, Field, LoadingBlock, Notice, Panel, SectionHeading, StatBlock, StatusPill, SubHeading } from "../components/ui.jsx";
import { IconDownload } from "../components/icons.jsx";

// Limits mirror ReportRequest in backend/report.py.
const MAX_TITLE = 1000;
const MAX_PROJECT = 200;

export default function Reports({ prefill }) {
  const [title, setTitle] = useState("");
  const [project, setProject] = useState("");
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (prefill?.text) setTitle(prefill.text.slice(0, MAX_TITLE)); }, [prefill]);

  const generate = async (e) => {
    e?.preventDefault();
    if (!title.trim()) return;
    setLoading(true); setError(null);
    try {
      const body = { title: title.trim() };
      if (project.trim()) body.project_name = project.trim();
      setReport(await api.generateReport(body));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const base = slugify(report?.project_name || report?.title);
  const day = new Date().toISOString().slice(0, 10);

  return (
    <div style={{ maxWidth: 820 }}>
      <div className="pq-no-print">
        <SectionHeading
          title="Generate a report"
          subtitle="Combine the field classifier with registry statistics into a structured summary for one invention title. You can download it or print it to PDF."
        />
        <form onSubmit={generate}>
          <Panel>
            <div style={{ display: "grid", gap: 16 }}>
              <Field label="Project name" htmlFor="rep-project" hint="Optional. Shown at the top of the report.">
                <input id="rep-project" className="pq-input" value={project} maxLength={MAX_PROJECT} onChange={(e) => setProject(e.target.value)} placeholder="e.g. AgriSense field trials" />
              </Field>
              <Field label="Invention title or description" htmlFor="rep-title">
                <textarea id="rep-title" className="pq-input" rows={4} value={title} maxLength={MAX_TITLE} onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. A wireless sensor network for real-time monitoring of soil moisture" />
              </Field>
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <Button type="submit" disabled={!title.trim() || loading}>{loading ? "Generating…" : "Generate report"}</Button>
              <span style={{ fontFamily: T.mono, fontSize: 12, color: T.grayLight }}>{title.length}/{MAX_TITLE}</span>
            </div>
          </Panel>
        </form>
        {loading && <LoadingBlock label="Generating report…" />}
        {error && <div style={{ marginTop: 20 }}><ErrorBanner error={error} title="The report could not be generated" onRetry={generate} /></div>}
      </div>

      {report && (
        <div className="pq-print-area" style={{ marginTop: 36, paddingTop: 28, borderTop: `1px solid ${T.border}` }}>
          <div className="pq-no-print" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
            <Button variant="secondary" onClick={() => downloadFile(`patentiq-${base}-${day}.json`, JSON.stringify(report, null, 2), "application/json")}><IconDownload size={15} /> JSON</Button>
            <Button variant="secondary" onClick={() => downloadFile(`patentiq-${base}-${day}.md`, buildReportMarkdown(report), "text/markdown")}><IconDownload size={15} /> Markdown</Button>
            <Button variant="secondary" onClick={() => window.print()}>Print or save as PDF</Button>
          </div>
          <ReportView r={report} />
        </div>
      )}
    </div>
  );
}

function ReportView({ r }) {
  const ctx = r.field_context || {};
  const city = r.top_filing_city_for_field || {};
  const reg = r.registry_context || {};
  const tier = confidenceTier(r.confidence_pct);
  return (
    <article>
      <h1 style={{ fontFamily: T.sans, fontSize: 24, fontWeight: 700, color: T.ink, margin: "0 0 6px", letterSpacing: "-0.01em" }}>
        {r.project_name || "PatentIQ report"}
      </h1>
      <p style={{ fontFamily: T.sans, fontSize: 14.5, color: T.gray, margin: "0 0 28px", lineHeight: 1.6, overflowWrap: "anywhere" }}>{r.title}</p>

      <SubHeading>Predicted field</SubHeading>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <span style={{ fontFamily: T.sans, fontSize: 21, fontWeight: 700, color: T.ink }}>{fieldLabel(r.predicted_field)}</span>
        <StatusPill tier={tier} label={`${{ high: "High", medium: "Medium", low: "Low" }[tier]} score · ${r.confidence_pct}%`} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 11, marginBottom: 32, maxWidth: 440 }}>
        {r.top_fields?.map((f) => (
          <div key={f.field}>
            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: T.sans, fontSize: 13, marginBottom: 4 }}>
              <span>{fieldLabel(f.field)}</span><span style={{ fontFamily: T.mono, color: T.gray }}>{f.confidence}%</span>
            </div>
            <div style={{ background: T.border, height: 6, borderRadius: 3 }}>
              <div style={{ width: `${Math.min(100, f.confidence)}%`, height: 6, borderRadius: 3, background: T.accent }} />
            </div>
          </div>
        ))}
      </div>

      <SubHeading>Where {fieldLabel(ctx.field || r.predicted_field)} sits in the registry</SubHeading>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 24, padding: "18px 0", borderTop: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}`, marginBottom: 14 }}>
        <StatBlock value={fmt(ctx.published)} label="Published applications" />
        <StatBlock value={fmt(ctx.granted)} label="Granted patents" />
        <StatBlock value={`${ctx.share_of_all_filings_pct}%`} label="Share of all published filings" />
        <StatBlock value={`${ctx.grant_activity_ratio_pct}%`} label="Granted-to-published ratio" />
      </div>
      {city.city && (
        <p style={{ fontFamily: T.sans, fontSize: 14, color: T.ink, margin: "0 0 32px", lineHeight: 1.6 }}>
          <strong>{city.city}</strong> has the most published applications in this field (<span style={{ fontFamily: T.mono }}>{fmt(city.count)}</span>).
        </p>
      )}

      <SubHeading>Registry context</SubHeading>
      <ul style={{ fontFamily: T.sans, fontSize: 14, color: T.ink, lineHeight: 1.8, margin: "0 0 32px", paddingLeft: 18 }}>
        {Array.isArray(reg.year_range) && <li>Years covered: {reg.year_range[0]}–{reg.year_range[1]}</li>}
        <li>Total published: {fmt(reg.total_published)}</li>
        <li>Total granted: {fmt(reg.total_granted)}</li>
        {reg.most_common_application_type && <li>Most common application type: {sentenceCase(reg.most_common_application_type)}</li>}
      </ul>

      <Notice tone="info">{r.disclaimer}</Notice>
    </article>
  );
}
