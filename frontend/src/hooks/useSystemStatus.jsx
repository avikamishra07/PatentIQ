import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client.js";

/**
 * Polls GET /similarity/status (and GET /health) and reduces them to one level:
 *   checking    first check not finished yet
 *   building    index state "building" or "not_started" (the status call itself starts the build)
 *   ready       index state "ready"
 *   unavailable index state "failed", or the API cannot be reached / answered with an error
 */
const SystemStatusContext = createContext(null);

const POLL_MS = { building: 2500, ready: 30000, unavailable: 8000, checking: 2500 };

export function SystemStatusProvider({ children }) {
  const [snap, setSnap] = useState({ level: "checking", status: null, health: null, error: null, checkedAt: null });
  const timer = useRef(null);
  const alive = useRef(true);
  const levelRef = useRef("checking");

  const check = useCallback(async () => {
    clearTimeout(timer.current);
    const [statusRes, healthRes] = await Promise.allSettled([api.similarityStatus(), api.health()]);
    if (!alive.current) return;

    let level, status = null, error = null;
    if (statusRes.status === "fulfilled") {
      status = statusRes.value;
      if (status.state === "ready") level = "ready";
      else if (status.state === "failed") { level = "unavailable"; error = status.error || "The similarity index failed to build."; }
      else level = "building";
    } else {
      level = "unavailable";
      error = statusRes.reason?.message || "The API did not respond.";
    }
    levelRef.current = level;
    setSnap({
      level, status, error,
      health: healthRes.status === "fulfilled" ? healthRes.value : null,
      checkedAt: new Date(),
    });
    timer.current = setTimeout(check, POLL_MS[level]);
  }, []);

  useEffect(() => {
    alive.current = true;
    check();
    return () => { alive.current = false; clearTimeout(timer.current); };
  }, [check]);

  const value = useMemo(() => ({ ...snap, refresh: check }), [snap, check]);
  return <SystemStatusContext.Provider value={value}>{children}</SystemStatusContext.Provider>;
}

export function useSystemStatus() {
  const ctx = useContext(SystemStatusContext);
  if (!ctx) throw new Error("useSystemStatus must be used inside <SystemStatusProvider>");
  return ctx;
}
