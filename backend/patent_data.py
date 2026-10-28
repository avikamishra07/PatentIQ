
from functools import lru_cache
from pathlib import Path

import pandas as pd

BASE_DIR = Path(__file__).resolve().parent
DATASET_PATH = BASE_DIR / "data" / "patents_combined.csv"

REQUIRED_COLUMNS = [
    "APPLICATION_NUMBER",
    "PUBLICATION_NUMBER",
    "PUBLICATION_DATE",
    "IPO_LOCATION",
    "TITLE_OF_INVENTION",
    "FIELD_OF_INVENTION",
    "PATENT_STATUS",
]


@lru_cache(maxsize=1)
def load_patents():
    """Load the combined dataset once and reuse it."""
    if not DATASET_PATH.exists():
        raise FileNotFoundError(
            f"Patent dataset not found: {DATASET_PATH}"
        )

    df = pd.read_csv(
        DATASET_PATH,
        usecols=lambda col: col in REQUIRED_COLUMNS,
        dtype=str,
        keep_default_na=False,
        encoding="utf-8-sig",
    )

    missing = set(REQUIRED_COLUMNS) - set(df.columns)
    if missing:
        raise ValueError(
            f"Dataset is missing required columns: {sorted(missing)}"
        )

    for col in REQUIRED_COLUMNS:
        df[col] = df[col].astype(str).str.strip()

    # Keep the master dataset unchanged; these are analysis filters.
    df["TITLE_OF_INVENTION"] = (
        df["TITLE_OF_INVENTION"].fillna("").str.strip()
    )

    return df


def get_dataset_summary():
    df = load_patents()

    return {
        "total_records": int(len(df)),
        "published_records": int(
            (df["PATENT_STATUS"] == "Published").sum()
        ),
        "granted_records": int(
            (df["PATENT_STATUS"] == "Granted").sum()
        ),
        "records_with_titles": int(
            df["TITLE_OF_INVENTION"].ne("").sum()
        ),
        "offices": sorted(
            office for office in df["IPO_LOCATION"].unique()
            if office
        ),
        "status": "loaded",
    }
