import React, { useEffect, useRef, useState } from "react";
import { T } from "./theme.js";
import GlobalStyles from "./components/GlobalStyles.jsx";
import StatusBadge from "./components/StatusBadge.jsx";
import {
  IconChart, IconClassify, IconClose, IconDashboard, IconMenu, IconPulse, IconReport, IconSearch, IconSimilar, IconSuggest, IconTable, LogoMark,
} from "./components/icons.jsx";
import { SystemStatusProvider, useSystemStatus } from "./hooks/useSystemStatus.jsx";
import { useHashRoute } from "./hooks/useHashRoute.js";
import Dashboard from "./pages/Dashboard.jsx";
import Classify from "./pages/Classify.jsx";
import Similarity from "./pages/Similarity.jsx";
import Suggestions from "./pages/Suggestions.jsx";
import Explorer from "./pages/Explorer.jsx";
import Analytics from "./pages/Analytics.jsx";
import Reports from "./pages/Reports.jsx";
import SystemStatus from "./pages/SystemStatus.jsx";

const PAGES = {
  dashboard: { label: "Dashboard", icon: IconDashboard, Component: Dashboard },
  classify: { label: "Classify", icon: IconClassify, Component: Classify },
  similarity: { label: "Similar patents", icon: IconSimilar, Component: Similarity },
  suggestions: { label: "Suggestions", icon: IconSuggest, Component: Suggestions },
  explorer: { label: "Dataset explorer", icon: IconTable, Component: Explorer },
  analytics: { label: "Analytics", icon: IconChart, Component: Analytics },
  reports: { label: "Reports", icon: IconReport, Component: Reports },
};

function Sidebar({ route, onNavigate, mobileOpen, onCloseMobile }) {
  return (
    <>
      {mobileOpen && <div className="pq-scrim" onClick={onCloseMobile} />}
      <aside className={`pq-sidebar${mobileOpen ? " pq-sidebar-open" : ""}`} style={{
        width: 232, background: T.navy, color: "#C6C5C0", display: "flex", flexDirection: "column", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "20px 20px 18px" }}>
          <div style={{ width: 30, height: 30, borderRadius: 6, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <LogoMark />
          </div>
          <span style={{ fontFamily: T.sans, fontSize: 16, fontWeight: 600, color: "#fff", letterSpacing: "-0.01em" }}>PatentIQ</span>
          <button className="pq-icon-btn pq-mobile-only" onClick={onCloseMobile} style={{ marginLeft: "auto", color: "#C6C5C0" }} aria-label="Close menu">
            <IconClose size={18} />
          </button>
        </div>
        <nav aria-label="Main" style={{ flex: 1, padding: "6px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
          {Object.entries(PAGES).map(([id, item]) => {
            const active = route === id;
            const ItemIcon = item.icon;
            return (
              <button
                key={id} onClick={() => onNavigate(id)} className="pq-nav-item" aria-current={active ? "page" : undefined}
                style={{
                  display: "flex", alignItems: "center", gap: 11, padding: "9px 12px", borderRadius: T.radius, border: "none",
                  background: active ? "rgba(255,255,255,0.09)" : "transparent",
                  borderLeft: active ? "2px solid #C9A85E" : "2px solid transparent",
                  color: active ? "#fff" : "#A9A8A2", fontFamily: T.sans, fontSize: 13.5, fontWeight: active ? 600 : 400,
                  cursor: "pointer", textAlign: "left", width: "100%",
                }}
              >
                <ItemIcon size={17} />
                <span style={{ flex: 1 }}>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

function TopBar({ title, onMobileMenu, searchValue, onSearchChange, onSearchSubmit, onStatus }) {
  const sys = useSystemStatus();
  return (
    <header className="pq-topbar" style={{
      height: 60, flexShrink: 0, display: "flex", alignItems: "center", gap: 16, padding: "0 24px",
      borderBottom: `1px solid ${T.border}`, background: T.surface, position: "sticky", top: 0, zIndex: 20,
    }}>
      <button className="pq-icon-btn pq-mobile-only" onClick={onMobileMenu} aria-label="Open menu" style={{ color: T.gray }}>
        <IconMenu size={20} />
      </button>
      <div style={{ fontFamily: T.sans, fontSize: 14, color: T.gray, whiteSpace: "nowrap" }}>
        <span className="pq-crumb-root">PatentIQ <span style={{ margin: "0 6px", color: T.borderStrong }}>/</span></span>
        <span style={{ color: T.ink, fontWeight: 600 }}>{title}</span>
      </div>

      <div style={{ flex: 1, maxWidth: 420, marginLeft: 12 }} className="pq-search-wrap">
        <div style={{ position: "relative" }}>
          <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: T.grayLight, display: "flex" }}>
            <IconSearch size={15} />
          </span>
          <input
            aria-label="Paste an invention title to classify"
            className="pq-input"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onSearchSubmit(); }}
            placeholder="Paste an invention title to classify…"
            style={{ padding: "8px 12px 8px 34px", fontSize: 13.5, background: T.bg, borderColor: T.border }}
          />
        </div>
      </div>

      <div style={{ marginLeft: "auto" }}>
        <StatusBadge level={sys.level} onClick={onStatus} />
      </div>
    </header>
  );
}

function Shell() {
  const [route, go] = useHashRoute();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [handoff, setHandoff] = useState({ target: null, nonce: 0 });
  const [visited, setVisited] = useState(() => new Set([route]));
  const first = useRef(true);

  // Pages stay mounted once opened, so results survive switching between sections.
  useEffect(() => {
    setVisited((v) => (v.has(route) ? v : new Set(v).add(route)));
    setMobileOpen(false);
    if (first.current) first.current = false; else window.scrollTo(0, 0);
  }, [route]);

  const navigate = (id, payload) => {
    if (payload) setHandoff((h) => ({ target: id, nonce: h.nonce + 1, ...payload }));
    go(id);
  };

  const submitSearch = () => {
    if (searchValue.trim()) { navigate("classify", { text: searchValue.trim() }); setSearchValue(""); }
  };

  return (
    <div className="pq-shell" style={{ minHeight: "100vh", background: T.bg, color: T.ink, fontFamily: T.sans }}>
      <GlobalStyles />
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <Sidebar route={route} onNavigate={(id) => navigate(id)} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <TopBar
            title={PAGES[route].label}
            onMobileMenu={() => setMobileOpen(true)}
            searchValue={searchValue}
            onSearchChange={setSearchValue}
            onSearchSubmit={submitSearch}
            onStatus={() => navigate("status")}
          />
          <main className="pq-main" style={{ flex: 1, padding: "32px 32px 64px" }}>
            {Object.entries(PAGES).filter(([id]) => visited.has(id)).map(([id, { Component }]) => (
              <div key={id} style={{ display: route === id ? "block" : "none" }}>
                <Component navigate={navigate} prefill={handoff.target === id ? handoff : null} />
              </div>
            ))}
          </main>
        </div>
      </div>
    </div>
  );
}

export default function PatentIQApp() {
  return (
    <SystemStatusProvider>
      <Shell />
    </SystemStatusProvider>
  );
}
