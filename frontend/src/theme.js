// Design tokens — carried over unchanged from the original PatentIQApp.jsx.
export const T = {
  bg: "#F7F7F5",
  surface: "#FFFFFF",
  navy: "#23262B",
  navyDeep: "#1A1C20",
  ink: "#1F2124",
  gray: "#5C5F66",
  grayLight: "#8D9096",
  border: "#E3E3E0",
  borderStrong: "#CACAC5",
  accent: "#8A6A28",
  accentSoft: "#F3ECDA",
  accentText: "#6E5320",
  green: "#1D7A52",
  greenSoft: "#E6F4ED",
  amber: "#B07417",
  amberSoft: "#FBF0DC",
  red: "#B23A2E",
  redSoft: "#FBEAE7",
  sans: "'Inter', -apple-system, 'Segoe UI', sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
  radius: 6,
};

export const TIER_COLOR = { high: T.green, medium: T.amber, low: T.grayLight };
export const TIER_BG = { high: T.greenSoft, medium: T.amberSoft, low: T.border };
export const TIER_LABEL = { high: "High", medium: "Medium", low: "Low" };

export const CHART_TOOLTIP = {
  contentStyle: { fontFamily: T.sans, fontSize: 12, border: `1px solid ${T.border}`, borderRadius: 6 },
};
export const AXIS_TICK = { fontFamily: T.sans, fontSize: 11, fill: T.gray };
