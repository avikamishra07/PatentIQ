import React from "react";
import { API_BASE_URL } from "../config.js";
import { useSystemStatus } from "../hooks/useSystemStatus.jsx";
import { T } from "../theme.js";
import { fmt } from "../utils/format.js";
import { Button, DataTable, Notice, Pill, SectionHeading, SubHeading } from "../components/ui.jsx";
import { LEVEL_META } from "../components/StatusBadge.jsx";

const EXPLAIN = {
  checking: "Checking the backend…",
  building: "The similarity index is being built or loaded from the disk cache. Similarity search returns 503 with a Retry-After hint until it finishes; the app retries automatically. Every other feature keeps working.",
  ready: "The similarity index is loaded and similarity search is available.",
  unavailable: "Similarity search cannot be used right now.",
};

export default function SystemStatus() {
  const sys = useSystemStatus();
  const m = LEVEL_META[sys.level];
  const s = sys.status;

  const rows = [
    { k: "Index state", v: s?.state ?? "—" },
    { k: "Indexed titles", v: s?.indexed_titles != null ? fmt(s.indexed_titles) : "—" },
    { k: "Indexed records", v: s?.indexed_records != null ? fmt(s.indexed_records) : "—" },
    { k: "Features", v: s?.features != null ? fmt(s.features) : "—" },
    { k: "Non-zero entries", v: s?.non_zeros != null ? fmt(s.non_zeros) : "—" },
    { k: "Matrix size", v: s?.matrix_mb != null ? `${s.matrix_mb} MB` : "—" },
    { k: "Cached queries", v: s?.cached_queries != null ? fmt(s.cached_queries) : "—" },
  ];
  if (s?.building_for_s != null) rows.splice(1, 0, { k: "Building for", v: `${s.building_for_s} s` });
  if (s?.progress) rows.splice(2, 0, { k: "Build progress", v: s.progress });

  return (
    <div style={{ maxWidth: 760 }}>
      <SectionHeading
        title="System status"
        subtitle="Live state of the backend and the similarity index. This page refreshes automatically."
        actions={<Button variant="secondary" small onClick={sys.refresh}>Check now</Button>}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }} aria-live="polite">
        <Pill color={m.color} bg={m.bg}>{m.label}</Pill>
        {sys.checkedAt && <span style={{ fontFamily: T.sans, fontSize: 12.5, color: T.gray }}>Last checked {sys.checkedAt.toLocaleTimeString()}</span>}
      </div>
      <p style={{ fontFamily: T.sans, fontSize: 14, color: T.ink, lineHeight: 1.6, margin: "0 0 20px", maxWidth: 620 }}>{EXPLAIN[sys.level]}</p>
      {sys.level === "unavailable" && sys.error && <Notice tone="warn" style={{ marginBottom: 24 }}>{sys.error}</Notice>}

      <div style={{ marginBottom: 36 }}>
        <SubHeading source="GET /similarity/status">Similarity index</SubHeading>
        <DataTable rowKey={(r) => r.k} rows={rows} columns={[
          { key: "k", label: "Property", width: 220 },
          { key: "v", label: "Value", render: (r) => <span style={{ fontFamily: T.mono, fontSize: 13, overflowWrap: "anywhere" }}>{r.v}</span> },
        ]} />
      </div>

      <div>
        <SubHeading source="GET /health">Backend</SubHeading>
        <DataTable rowKey={(r) => r.k} rows={[
          { k: "API address", v: API_BASE_URL },
          { k: "Reachable", v: sys.health ? "Yes" : sys.checkedAt ? "No" : "—" },
          { k: "Health", v: sys.health?.status ?? "—" },
          { k: "Classifier classes", v: sys.health?.classes ?? "—" },
        ]} columns={[
          { key: "k", label: "Property", width: 220 },
          { key: "v", label: "Value", render: (r) => <span style={{ fontFamily: T.mono, fontSize: 13, overflowWrap: "anywhere" }}>{r.v}</span> },
        ]} />
      </div>
    </div>
  );
}
