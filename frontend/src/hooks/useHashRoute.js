import { useCallback, useEffect, useState } from "react";

export const ROUTES = ["dashboard", "classify", "similarity", "suggestions", "explorer", "analytics", "reports", "status"];

function read() {
  const id = window.location.hash.replace(/^#\/?/, "").split(/[/?]/)[0];
  return ROUTES.includes(id) ? id : "dashboard";
}

/** Tiny hash router (#/similarity): back/forward and refresh work, no dependency. */
export function useHashRoute() {
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const go = useCallback((id) => {
    if (!ROUTES.includes(id)) return;
    if (window.location.hash !== `#/${id}`) window.location.hash = `/${id}`;
    else setRoute(id);
  }, []);
  return [route, go];
}
