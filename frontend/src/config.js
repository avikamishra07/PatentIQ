// Backend location. Set VITE_API_BASE_URL in frontend/.env (see .env.example).
// Falls back to the README's default local backend when unset.
const DEFAULT_API_BASE_URL = "http://localhost:8000";

export function resolveApiBaseUrl(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  return (value || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

export const API_BASE_URL = resolveApiBaseUrl(import.meta.env?.VITE_API_BASE_URL);
