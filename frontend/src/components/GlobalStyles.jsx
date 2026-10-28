import React from "react";
import { T } from "../theme.js";

export default function GlobalStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
      * { box-sizing: border-box; }
      html, body { margin: 0; }
      body { background: ${T.bg}; }
      input:focus, textarea:focus, select:focus, button:focus-visible, a:focus-visible, summary:focus-visible {
        outline: 2px solid ${T.accent}; outline-offset: 1px;
      }
      .pq-btn:hover:not(:disabled) { filter: brightness(0.96); }
      .pq-nav-item:hover { background: rgba(255,255,255,0.06) !important; }
      .pq-icon-btn { background: none; border: none; cursor: pointer; padding: 6px; border-radius: 6px; display: flex; }
      .pq-icon-btn:hover { background: ${T.bg}; }
      .pq-input {
        width: 100%; padding: 9px 12px; font-family: ${T.sans}; font-size: 14px; color: ${T.ink};
        background: ${T.surface}; border: 1px solid ${T.borderStrong}; border-radius: ${T.radius}px;
      }
      .pq-input:focus { border-color: ${T.accent}; }
      .pq-input:disabled { background: ${T.bg}; color: ${T.grayLight}; cursor: not-allowed; }
      textarea.pq-input { line-height: 1.55; resize: vertical; padding: 12px 14px; font-size: 14.5px; }
      .pq-scrim { position: fixed; inset: 0; background: rgba(12,17,30,0.4); z-index: 30; display: none; }
      .pq-mobile-only { display: none; }
      .pq-sidebar { position: sticky; top: 0; height: 100vh; align-self: flex-start; }
      .pq-table-wrap { overflow-x: auto; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.surface}; }
      table.pq-table { width: 100%; border-collapse: collapse; }
      table.pq-table th { text-align: left; font-family: ${T.sans}; font-size: 12px; font-weight: 600; color: ${T.gray}; padding: 10px 12px; border-bottom: 1px solid ${T.border}; white-space: nowrap; background: ${T.surface}; }
      table.pq-table td { font-family: ${T.sans}; font-size: 13.5px; color: ${T.ink}; padding: 11px 12px; border-bottom: 1px solid ${T.border}; vertical-align: top; }
      table.pq-table tbody tr:last-child td { border-bottom: none; }
      table.pq-table tbody tr:hover td { background: ${T.bg}; }
      table.pq-table .num { text-align: right; font-family: ${T.mono}; font-size: 13px; white-space: nowrap; }
      table.pq-table th.num { text-align: right; font-family: ${T.sans}; }
      details > summary { cursor: pointer; list-style: none; }
      details > summary::-webkit-details-marker { display: none; }
      .pq-spinner { width: 18px; height: 18px; border: 2px solid ${T.border}; border-top-color: ${T.accent}; border-radius: 50%; animation: pq-spin 0.8s linear infinite; flex-shrink: 0; }
      @keyframes pq-spin { to { transform: rotate(360deg); } }
      .pq-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
      .pq-form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 14px; }
      .pq-chip { display: inline-block; font-family: ${T.sans}; font-size: 12px; color: ${T.accentText}; background: ${T.accentSoft}; padding: 2px 9px; border-radius: 999px; margin: 0 6px 6px 0; }
      .pq-chip-muted { color: ${T.gray}; background: ${T.border}; }
      .pq-tabs { display: flex; gap: 4px; border-bottom: 1px solid ${T.border}; margin-bottom: 28px; overflow-x: auto; }
      .pq-tab { background: none; border: none; border-bottom: 2px solid transparent; padding: 10px 14px; font-family: ${T.sans}; font-size: 13.5px; color: ${T.gray}; cursor: pointer; white-space: nowrap; margin-bottom: -1px; }
      .pq-tab[aria-selected="true"] { color: ${T.ink}; font-weight: 600; border-bottom-color: ${T.accent}; }
      .pq-linkbtn { background: none; border: none; padding: 0; font-family: ${T.sans}; font-size: 13px; color: ${T.accentText}; font-weight: 600; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
      .pq-linkbtn:disabled { color: ${T.grayLight}; cursor: default; text-decoration: none; }
      @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; } }

      @media (max-width: 860px) {
        .pq-sidebar { position: fixed; top: 0; bottom: 0; left: -260px; height: 100%; z-index: 35; transition: left 0.2s ease; }
        .pq-sidebar-open { left: 0; }
        .pq-scrim { display: block; }
        .pq-mobile-only { display: flex; }
        .pq-search-wrap { display: none; }
        .pq-grid-2 { grid-template-columns: 1fr; gap: 32px; }
        .pq-main { padding: 22px 16px 56px !important; }
        .pq-topbar { padding: 0 14px !important; }
        .pq-crumb-root { display: none; }
      }

      @media print {
        .pq-sidebar, .pq-topbar, .pq-scrim, .pq-no-print { display: none !important; }
        body, .pq-shell { background: #fff !important; }
        .pq-main { padding: 0 !important; }
        .pq-print-area { max-width: none !important; }
      }
    `}</style>
  );
}
