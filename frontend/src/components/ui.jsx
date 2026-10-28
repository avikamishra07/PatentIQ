import React from "react";
import { T, TIER_BG, TIER_COLOR, TIER_LABEL } from "../theme.js";
import { fmt, fieldLabel } from "../utils/format.js";
import { IconAlert, IconInbox } from "./icons.jsx";

export function Button({ children, variant = "primary", small = false, ...props }) {
  const styles = {
    primary: { background: T.navy, color: "#fff", border: `1px solid ${T.navy}` },
    secondary: { background: T.surface, color: T.ink, border: `1px solid ${T.borderStrong}` },
    ghost: { background: "transparent", color: T.gray, border: "1px solid transparent" },
  };
  return (
    <button
      type="button"
      {...props}
      className="pq-btn"
      style={{
        ...styles[variant],
        fontFamily: T.sans, fontSize: small ? 12.5 : 14, fontWeight: 500,
        padding: small ? "5px 10px" : "9px 18px", borderRadius: T.radius,
        cursor: props.disabled ? "default" : "pointer", opacity: props.disabled ? 0.5 : 1,
        display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap",
        transition: "background 0.15s ease, border-color 0.15s ease",
        ...(props.style || {}),
      }}
    >
      {children}
    </button>
  );
}

export function Pill({ color, bg, children }) {
  return (
    <span style={{
      fontFamily: T.sans, fontSize: 12, fontWeight: 600, color, background: bg,
      padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap", display: "inline-block",
    }}>
      {children}
    </span>
  );
}

export function StatusPill({ tier, label }) {
  return <Pill color={TIER_COLOR[tier]} bg={TIER_BG[tier]}>{label || TIER_LABEL[tier]}</Pill>;
}

export function SectionHeading({ title, subtitle, actions }) {
  return (
    <div style={{ marginBottom: 22, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
      <div>
        <h2 style={{ fontFamily: T.sans, fontSize: 20, fontWeight: 600, color: T.ink, margin: "0 0 4px" }}>{title}</h2>
        {subtitle && <p style={{ fontFamily: T.sans, fontSize: 14, color: T.gray, margin: 0, maxWidth: 640, lineHeight: 1.55 }}>{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function SubHeading({ children, source }) {
  return (
    <div style={{ margin: "0 0 16px" }}>
      <h3 style={{ fontFamily: T.sans, fontWeight: 600, fontSize: 15.5, color: T.ink, margin: 0 }}>{children}</h3>
      {source && <p style={{ fontFamily: T.sans, fontSize: 12, color: T.grayLight, margin: "3px 0 0" }}>{source}</p>}
    </div>
  );
}

export function StatBlock({ value, label, mono = true }) {
  return (
    <div>
      <div style={{ fontFamily: mono ? T.mono : T.sans, fontSize: 24, fontWeight: 600, color: T.ink, letterSpacing: "-0.01em" }}>{value}</div>
      <div style={{ fontFamily: T.sans, fontSize: 12.5, color: T.gray, marginTop: 3 }}>{label}</div>
    </div>
  );
}

export function StatStrip({ children }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 24,
      padding: "22px 0", borderTop: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}`, marginBottom: 36,
    }}>
      {children}
    </div>
  );
}

/** Horizontal share bars: dist = { label: count }. */
export function FieldBars({ dist, highlight, limit, format = fieldLabel }) {
  const entries = Object.entries(dist || {}).sort((a, b) => b[1] - a[1]).slice(0, limit || 100);
  if (!entries.length) return <p style={{ fontFamily: T.sans, fontSize: 13, color: T.gray }}>No data.</p>;
  const max = entries[0][1] || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      {entries.map(([label, count]) => (
        <div key={label}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontFamily: T.sans, fontSize: 13, marginBottom: 4, color: label === highlight ? T.accentText : T.ink, fontWeight: label === highlight ? 600 : 400 }}>
            <span>{format(label)}</span>
            <span style={{ fontFamily: T.mono, color: T.gray, fontSize: 12.5 }}>{fmt(count)}</span>
          </div>
          <div style={{ background: T.border, height: 6, borderRadius: 3 }}>
            <div style={{ width: `${(count / max) * 100}%`, height: 6, borderRadius: 3, background: label === highlight ? T.accent : T.borderStrong, transition: "width 0.5s ease" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Spinner() { return <span className="pq-spinner" role="presentation" />; }

export function LoadingBlock({ label = "Loading…", hint }) {
  return (
    <div role="status" aria-live="polite" style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "18px 2px", fontFamily: T.sans }}>
      <Spinner />
      <div>
        <div style={{ fontSize: 13.5, color: T.ink }}>{label}</div>
        {hint && <div style={{ fontSize: 12.5, color: T.gray, marginTop: 3, maxWidth: 520, lineHeight: 1.5 }}>{hint}</div>}
      </div>
    </div>
  );
}

export function ErrorBanner({ error, title, onRetry, children }) {
  const message = typeof error === "string" ? error : error?.message;
  return (
    <div role="alert" style={{ background: T.redSoft, border: `1px solid #EBC3BD`, borderRadius: T.radius, padding: "12px 14px", display: "flex", gap: 10, alignItems: "flex-start", fontFamily: T.sans }}>
      <span style={{ color: T.red, marginTop: 1, flexShrink: 0 }}><IconAlert size={17} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: T.red }}>{title || "Something went wrong"}</div>
        <div style={{ fontSize: 13, color: T.ink, marginTop: 3, lineHeight: 1.55, overflowWrap: "anywhere" }}>{message}</div>
        {children}
        {onRetry && <div style={{ marginTop: 10 }}><Button variant="secondary" small onClick={onRetry}>Try again</Button></div>}
      </div>
    </div>
  );
}

export function Notice({ tone = "info", children, style }) {
  const tones = {
    info: { bg: T.accentSoft, border: "#E6D9B4", color: T.accentText },
    warn: { bg: T.amberSoft, border: "#E9D6A8", color: T.amber },
    ok: { bg: T.greenSoft, border: "#BFE1D0", color: T.green },
  }[tone];
  return (
    <div style={{ background: tones.bg, border: `1px solid ${tones.border}`, borderRadius: T.radius, padding: "10px 14px", fontFamily: T.sans, fontSize: 13, color: tones.color, lineHeight: 1.55, ...style }}>
      {children}
    </div>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div style={{ textAlign: "center", padding: "44px 20px", border: `1px dashed ${T.borderStrong}`, borderRadius: 8, background: T.surface, fontFamily: T.sans }}>
      <div style={{ color: T.grayLight, display: "flex", justifyContent: "center", marginBottom: 10 }}><IconInbox size={26} /></div>
      <div style={{ fontSize: 15, fontWeight: 600, color: T.ink }}>{title}</div>
      {children && <div style={{ fontSize: 13.5, color: T.gray, marginTop: 6, maxWidth: 460, marginInline: "auto", lineHeight: 1.55 }}>{children}</div>}
    </div>
  );
}

export function Panel({ children, style }) {
  return <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: 20, ...style }}>{children}</div>;
}

export function Field({ label, htmlFor, hint, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} style={{ display: "block", fontFamily: T.sans, fontSize: 13, fontWeight: 600, color: T.ink, marginBottom: 6 }}>{label}</label>
      {children}
      {hint && <div style={{ fontFamily: T.sans, fontSize: 12, color: T.grayLight, marginTop: 5, lineHeight: 1.45 }}>{hint}</div>}
    </div>
  );
}

export function Select({ id, value, onChange, options, anyLabel = "Any", disabled, format = (v) => v }) {
  return (
    <select id={id} className="pq-input" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">{anyLabel}</option>
      {options.map((o) => <option key={o} value={o}>{format(o)}</option>)}
    </select>
  );
}

export function Tabs({ tabs, value, onChange, label }) {
  return (
    <div className="pq-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className="pq-tab" onClick={() => onChange(t.id)}>{t.label}</button>
      ))}
    </div>
  );
}

export function Pagination({ page, totalPages, onPage, disabled }) {
  const [jump, setJump] = React.useState("");
  const go = () => {
    const n = Number(jump);
    if (Number.isInteger(n) && n >= 1 && n <= totalPages) { onPage(n); setJump(""); }
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontFamily: T.sans, fontSize: 13, color: T.gray }}>
      <Button variant="secondary" small disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
      <span>Page <strong style={{ color: T.ink, fontFamily: T.mono }}>{fmt(page)}</strong> of <span style={{ fontFamily: T.mono }}>{fmt(totalPages)}</span></span>
      <Button variant="secondary" small disabled={disabled || page >= totalPages} onClick={() => onPage(page + 1)}>Next</Button>
      <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
        <label htmlFor="pq-jump">Go to page</label>
        <input id="pq-jump" className="pq-input" style={{ width: 84, padding: "5px 8px" }} type="number" min={1} max={totalPages} value={jump}
          onChange={(e) => setJump(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") go(); }} />
        <Button variant="secondary" small onClick={go} disabled={disabled || !jump}>Go</Button>
      </span>
    </div>
  );
}

export function DataTable({ columns, rows, rowKey }) {
  return (
    <div className="pq-table-wrap">
      <table className="pq-table">
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={c.num ? "num" : undefined} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey ? rowKey(r, i) : i}>
              {columns.map((c) => <td key={c.key} className={c.num ? "num" : undefined}>{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Shows loading / error / empty / content for a useAsync result. */
export function AsyncBlock({ state, loadingLabel, loadingHint, errorTitle, children }) {
  if (state.loading && !state.data) return <LoadingBlock label={loadingLabel} hint={loadingHint} />;
  if (state.error && !state.data) return <ErrorBanner error={state.error} title={errorTitle} onRetry={state.reload} />;
  if (!state.data) return null;
  return children(state.data);
}
