// Pure helpers for the Personalized Suggestions page (kept out of the component so they can be unit-tested).
// Limits mirror SuggestionRequest in backend/suggestions_api.py.
export const MAX_DESCRIPTION = 2000;
export const MAX_SUGGESTIONS = 30;
export const DEFAULT_FORM = {
  description: "", field: "", status: "", office: "", year_from: "", year_to: "", top_k: 10, min_score: 0.05,
};

const isInt = (v, lo, hi) => v !== "" && Number.isInteger(Number(v)) && Number(v) >= lo && Number(v) <= hi;

/** Returns an error sentence, or null when the form can be submitted. */
export function validateForm(form) {
  const d = form.description.trim();
  if (!d) return "Describe your invention first.";
  if (!/[A-Za-z]{2,}/.test(d)) return "Use English words to describe what the invention is or does; numbers and symbols alone can't be searched.";
  if (d.length > MAX_DESCRIPTION) return `The description is limited to ${MAX_DESCRIPTION} characters.`;
  if (!isInt(form.top_k, 1, MAX_SUGGESTIONS)) return `Number of suggestions must be a whole number from 1 to ${MAX_SUGGESTIONS}.`;
  const ms = Number(form.min_score);
  if (form.min_score === "" || Number.isNaN(ms) || ms < 0 || ms > 1) return "Minimum relevance must be between 0 and 1.";
  for (const k of ["year_from", "year_to"]) {
    if (form[k] !== "" && !isInt(form[k], 1800, 2200)) return "Years must be whole numbers between 1800 and 2200.";
  }
  if (form.year_from !== "" && form.year_to !== "" && Number(form.year_from) > Number(form.year_to)) {
    return "“From year” must not be later than “To year”.";
  }
  return null;
}

/** Request body for api.suggestionsSearch; empty filters are omitted. */
export function buildBody(form) {
  const body = { description: form.description.trim(), top_k: Number(form.top_k), min_score: Number(form.min_score) };
  for (const k of ["field", "status", "office"]) if (form[k]) body[k] = form[k];
  for (const k of ["year_from", "year_to"]) if (form[k] !== "") body[k] = Number(form[k]);
  return body;
}

/** Show a missing value as an em dash instead of "null"/"undefined". */
export const orDash = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));

/** Relevance score (0–1) as a percentage string. */
export function pct(score) {
  return typeof score === "number" && Number.isFinite(score) ? `${(score * 100).toFixed(1)}%` : "—";
}

/** Short heading for the empty-results state, by why it is empty. */
export function emptyReason(data) {
  const hasFilters = Object.keys(data?.query?.filters || {}).length > 0;
  return hasFilters ? "No suggestions match these filters" : "No suggestions found";
}
