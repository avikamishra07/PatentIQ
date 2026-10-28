import React from "react";
import { T } from "../theme.js";

export const LEVEL_META = {
  checking: { label: "Checking…", color: T.grayLight, bg: T.border },
  building: { label: "Index building", color: T.amber, bg: T.amberSoft },
  ready: { label: "Index ready", color: T.green, bg: T.greenSoft },
  unavailable: { label: "Index unavailable", color: T.red, bg: T.redSoft },
};

export default function StatusBadge({ level, onClick }) {
  const m = LEVEL_META[level] || LEVEL_META.checking;
  return (
    <button type="button" onClick={onClick} title="Similarity index status — open System status"
      style={{
        display: "inline-flex", alignItems: "center", gap: 7, border: "none", cursor: "pointer",
        fontFamily: T.sans, fontSize: 12.5, fontWeight: 600, color: m.color, background: m.bg,
        padding: "5px 11px", borderRadius: 999,
      }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: m.color }} />
      {m.label}
    </button>
  );
}
