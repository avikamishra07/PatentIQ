import { describe, expect, it } from "vitest";
import { buildReportMarkdown } from "../src/utils/report.js";
import { fieldLabel, slugify, strengthTier, confidenceTier } from "../src/utils/format.js";

// A real /report/generate response (captured from the running backend).
const REPORT = {
  project_name: "AgriSense", title: "wireless sensor network for soil moisture",
  predicted_field: "COMMUNICATION", confidence_pct: 17.8,
  top_fields: [{ field: "COMMUNICATION", confidence: 17.8 }, { field: "BIOMEDICAL", confidence: 13.0 }, { field: "MECHANICAL", confidence: 8.8 }],
  field_context: { field: "COMMUNICATION", published: 40400, granted: 28405, share_of_all_filings_pct: 8.3, grant_activity_ratio_pct: 70.3 },
  top_filing_city_for_field: { city: "Chennai", count: 18457 },
  registry_context: { year_range: [1976, 2026], total_published: 485796, total_granted: 310731, most_common_application_type: "ORDINARY APPLICATION" },
  disclaimer: "Auto-generated ... not a prior-art or novelty determination.",
};

describe("buildReportMarkdown", () => {
  const md = buildReportMarkdown(REPORT, new Date("2026-10-21T10:00:00Z"));
  it("uses the project name as the heading and includes the title", () => {
    expect(md).toContain("# AgriSense");
    expect(md).toContain("**Invention title:** wireless sensor network for soil moisture");
  });
  it("includes only returned numbers", () => {
    expect(md).toContain("Published applications: 40,400");
    expect(md).toContain("Top filing city for this field: Chennai (18,457 published applications)");
    expect(md).toContain("| 2 | Biomedical | 13% |");
    expect(md).toContain("Years covered: 1976–2026");
    expect(md).toContain("Ordinary application");
  });
  it("carries the disclaimer and export date", () => {
    expect(md).toContain("not a prior-art or novelty determination");
    expect(md).toContain("Exported from PatentIQ on 2026-10-21");
  });
  it("falls back to a generic heading without a project name", () => {
    expect(buildReportMarkdown({ ...REPORT, project_name: null })).toContain("# PatentIQ report");
  });
});

describe("format helpers", () => {
  it("keeps two-letter dataset codes such as NA", () => {
    expect(fieldLabel("NA")).toBe("NA");
    expect(fieldLabel("COMPUTER")).toBe("Computer");
    expect(fieldLabel("Miscellaneous")).toBe("Miscellaneous");
  });
  it("slugifies file names safely", () => {
    expect(slugify("AgriSense: Field/Trials #1")).toBe("agrisense-field-trials-1");
    expect(slugify("")).toBe("report");
  });
  it("maps match strength and score tiers", () => {
    expect(strengthTier("high overlap")).toBe("high");
    expect(strengthTier("moderate overlap")).toBe("medium");
    expect(strengthTier("very low overlap")).toBe("low");
    expect(confidenceTier(61)).toBe("high");
    expect(confidenceTier(17.8)).toBe("low");
  });
});
