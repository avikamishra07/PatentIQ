import React, { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useAsync } from "../hooks/useAsync.js";
import { T } from "../theme.js";
import { confidenceTier, fieldLabel } from "../utils/format.js";
import { Button, ErrorBanner, Notice, SectionHeading, StatusPill } from "../components/ui.jsx";

const MAX_CHARS = 1000; // PredictRequest.title max_length

export default function Classify({ prefill, navigate }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);   // { top, matched, title }
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const metrics = useAsync((s) => api.modelMetrics(s), []);

  useEffect(() => { if (prefill?.text) setText(prefill.text.slice(0, MAX_CHARS)); }, [prefill]);

  const analyze = async () => {
    const title = text.trim();
    if (!title) return;
    setLoading(true); setError(null);
    try {
      const r = await api.predict(title);
      setResult({ ...r, title });
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  };

  const top = result?.top?.[0];

  return (
    <div style={{ maxWidth: 760 }}>
      <SectionHeading
        title="Analyze an innovation"
        subtitle="Enter an invention title or short description to see its predicted field of invention, based on patterns learned from India's published and granted patent registries."
      />

      <label htmlFor="classify-text" style={{ display: "block", fontFamily: T.sans, fontSize: 13, fontWeight: 600, color: T.ink, marginBottom: 8 }}>
        Invention title or description
      </label>
      <textarea
        id="classify-text" className="pq-input" rows={5} maxLength={MAX_CHARS} value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") analyze(); }}
        placeholder="e.g. A wireless sensor network for real-time monitoring of soil moisture in agricultural fields"
      />
      <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <Button onClick={analyze} disabled={!text.trim() || loading}>{loading ? "Analyzing…" : "Analyze innovation"}</Button>
        <span style={{ fontFamily: T.mono, fontSize: 12, color: T.grayLight }}>{text.length}/{MAX_CHARS}</span>
      </div>

      {error && (
        <div style={{ marginTop: 24 }}>
          <ErrorBanner error={error} title="The classifier could not analyze this text" onRetry={analyze} />
        </div>
      )}

      {result && (
        <div style={{ marginTop: 40, paddingTop: 32, borderTop: `1px solid ${T.border}` }}>
          <SectionHeading title="Analysis result" subtitle={`“${result.title.length > 140 ? `${result.title.slice(0, 140)}…` : result.title}”`} />

          {!result.matched && (
            <Notice tone="warn" style={{ marginBottom: 20 }}>
              Low confidence across all fields: the top score is below the API&apos;s 15% threshold, so this text doesn&apos;t strongly resemble any single class in the training data.
            </Notice>
          )}

          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
            <h3 style={{ fontFamily: T.sans, fontSize: 21, fontWeight: 700, color: T.ink, margin: 0 }}>{fieldLabel(top.field)}</h3>
            <StatusPill tier={confidenceTier(top.confidence)} label={`${{ high: "High", medium: "Medium", low: "Low" }[confidenceTier(top.confidence)]} score`} />
          </div>
          <p style={{ fontFamily: T.sans, fontSize: 13, color: T.gray, margin: "0 0 22px" }}>
            Predicted field · confidence score <span style={{ fontFamily: T.mono }}>{top.confidence}%</span>
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 11, marginBottom: 20, maxWidth: 460 }}>
            {result.top.map((r) => (
              <div key={r.field}>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: T.sans, fontSize: 13, marginBottom: 4 }}>
                  <span>{fieldLabel(r.field)}</span>
                  <span style={{ fontFamily: T.mono, color: T.gray }}>{r.confidence}%</span>
                </div>
                <div style={{ background: T.border, height: 6, borderRadius: 3 }}>
                  <div style={{ width: `${Math.min(100, r.confidence)}%`, height: 6, borderRadius: 3, background: T.accent }} />
                </div>
              </div>
            ))}
          </div>

          <p style={{ fontFamily: T.sans, fontSize: 12.5, color: T.gray, lineHeight: 1.6, margin: "0 0 22px", maxWidth: 560 }}>
            Scores come from a softmax over the classifier&apos;s decision values. They rank the fields against each other but are not calibrated probabilities.
            {metrics.data && (
              <> On held-out data this model classified {(metrics.data.accuracy * 100).toFixed(1)}% of patents correctly across {metrics.data.classes.length} fields (macro F1 {metrics.data.f1_macro.toFixed(2)}).</>
            )}
          </p>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button variant="secondary" onClick={() => navigate("similarity", { text: result.title })}>Find similar patents</Button>
            <Button variant="secondary" onClick={() => navigate("reports", { text: result.title })}>Generate report</Button>
          </div>
        </div>
      )}
    </div>
  );
}
