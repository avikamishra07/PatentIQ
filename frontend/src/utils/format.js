export function fmt(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString("en-IN");
}

/** "COMPUTER" -> "Computer". Two-letter codes such as "NA" are left as they are. */
export function fieldLabel(s) {
  if (!s) return "—";
  if (s.length <= 2) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** "ORDINARY APPLICATION" -> "Ordinary application" */
export function sentenceCase(s) {
  if (!s) return "—";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function confidenceTier(pct) {
  if (pct >= 60) return "high";
  if (pct >= 30) return "medium";
  return "low";
}

export function strengthTier(label = "") {
  if (label.startsWith("high")) return "high";
  if (label.startsWith("moderate")) return "medium";
  return "low";
}

export function slugify(s, fallback = "report") {
  const out = String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return out || fallback;
}

export function downloadFile(filename, text, mime) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error("aborted"), { kind: "aborted" }));
    const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(Object.assign(new Error("aborted"), { kind: "aborted" })); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
