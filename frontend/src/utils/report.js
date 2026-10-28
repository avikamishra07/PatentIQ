import { fieldLabel, sentenceCase } from "./format.js";

const n = (v) => (typeof v === "number" ? v.toLocaleString("en-US") : "—");

/** Markdown rendering of a /report/generate response. Uses only fields the API returned. */
export function buildReportMarkdown(r, exportedOn = new Date()) {
  const ctx = r.field_context || {};
  const city = r.top_filing_city_for_field || {};
  const reg = r.registry_context || {};
  const lines = [];
  lines.push(`# ${r.project_name ? r.project_name : "PatentIQ report"}`);
  lines.push("");
  lines.push(`**Invention title:** ${r.title}`);
  lines.push("");
  lines.push("## Predicted field");
  lines.push("");
  lines.push(`**${fieldLabel(r.predicted_field)}** — confidence score ${r.confidence_pct}%`);
  lines.push("");
  if (Array.isArray(r.top_fields) && r.top_fields.length) {
    lines.push("| Rank | Field | Confidence score |");
    lines.push("|---|---|---|");
    r.top_fields.forEach((f, i) => lines.push(`| ${i + 1} | ${fieldLabel(f.field)} | ${f.confidence}% |`));
    lines.push("");
  }
  lines.push(`## Where ${fieldLabel(ctx.field || r.predicted_field)} sits in the registry`);
  lines.push("");
  lines.push(`- Published applications: ${n(ctx.published)}`);
  lines.push(`- Granted patents: ${n(ctx.granted)}`);
  lines.push(`- Share of all published filings: ${ctx.share_of_all_filings_pct}%`);
  lines.push(`- Granted-to-published activity ratio: ${ctx.grant_activity_ratio_pct}%`);
  if (city.city) lines.push(`- Top filing city for this field: ${city.city} (${n(city.count)} published applications)`);
  lines.push("");
  lines.push("## Registry context");
  lines.push("");
  if (Array.isArray(reg.year_range)) lines.push(`- Years covered: ${reg.year_range[0]}–${reg.year_range[1]}`);
  lines.push(`- Total published: ${n(reg.total_published)}`);
  lines.push(`- Total granted: ${n(reg.total_granted)}`);
  if (reg.most_common_application_type) lines.push(`- Most common application type: ${sentenceCase(reg.most_common_application_type)}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`_${r.disclaimer}_`);
  lines.push("");
  lines.push(`_Exported from PatentIQ on ${exportedOn.toISOString().slice(0, 10)}._`);
  lines.push("");
  return lines.join("\n");
}
