
from pathlib import Path
import pandas as pd
import json

PROJECT = Path(__file__).resolve().parents[2]
DATASET_DIR = PROJECT.parent / "Dataset-idea lab"
OUTPUT_DIR = PROJECT / "backend" / "data"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Adjust these keywords only if your filenames use different labels.
def identify_status(filename):
    name = filename.lower()
    if name.startswith("7a444d4c-"):
        return "Granted"
    if name.startswith("90855660-"):
        return "Published"
    return None

files = sorted(DATASET_DIR.glob("*.csv"))

if not files:
    raise FileNotFoundError(f"No CSV files found in {DATASET_DIR}")

frames = []
audit = []

for file in files:
    status = identify_status(file.name)

    if status is None:
        print(f"SKIPPED (cannot identify status from filename): {file.name}")
        continue

    df = pd.read_csv(file, dtype=str, keep_default_na=False)
    df.columns = [col.strip().upper() for col in df.columns]

    for col in df.columns:
        df[col] = df[col].astype(str).str.strip()

    row_count = len(df)
    exact_duplicates = int(df.duplicated().sum())

    # Parse dates explicitly as day/month/year.
    for col in ["DATE_OF_FILING", "PUBLICATION_DATE"]:
        if col in df.columns:
            parsed = pd.to_datetime(
                df[col].replace("", pd.NA),
                format="%d/%m/%Y",
                errors="coerce"
            )
            df[col] = parsed.dt.strftime("%Y-%m-%d").fillna("")

    df["PATENT_STATUS"] = status
    df["SOURCE_FILE"] = file.name

    audit.append({
        "file": file.name,
        "status": status,
        "rows_before": row_count,
        "exact_duplicate_rows": exact_duplicates,
        "columns": list(df.columns),
        "empty_titles": int(
            (df["TITLE_OF_INVENTION"] == "").sum()
        ) if "TITLE_OF_INVENTION" in df.columns else None,
        "missing_application_numbers": int(
            (df["APPLICATION_NUMBER"] == "").sum()
        ) if "APPLICATION_NUMBER" in df.columns else None
    })

    # Remove only exact duplicates within each source file.
    df = df.drop_duplicates()
    frames.append(df)

if not frames:
    raise ValueError(
        "No files were processed. Check that filenames contain "
        "'published'/'publish' or 'granted'/'grant'."
    )

combined = pd.concat(frames, ignore_index=True, sort=False)

output_csv = OUTPUT_DIR / "patents_combined.csv"
combined.to_csv(output_csv, index=False, encoding="utf-8-sig")

audit_report = {
    "input_folder": str(DATASET_DIR),
    "processed_files": len(frames),
    "rows_after_within_file_exact_deduplication": len(combined),
    "status_counts": combined["PATENT_STATUS"].value_counts().to_dict(),
    "audit_by_file": audit,
    "notes": [
        "Original CSV files were not modified.",
        "Only exact duplicate rows within each source file were removed.",
        "Records with the same application number were not automatically removed.",
        "Cross-file and published/granted overlap needs separate review.",
        "Filename-based status detection must be verified."
    ]
}

report_path = OUTPUT_DIR / "dataset_audit.json"
report_path.write_text(
    json.dumps(audit_report, indent=2, ensure_ascii=False),
    encoding="utf-8"
)

print("\nDataset processing complete.")
print(f"Files processed: {len(frames)}")
print(f"Combined rows: {len(combined):,}")
print(f"Published/granted counts: {audit_report['status_counts']}")
print(f"Combined CSV: {output_csv}")
print(f"Audit report: {report_path}")

