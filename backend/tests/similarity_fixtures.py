"""Tiny synthetic patent table used by the similarity tests (no real data)."""
import sys
from pathlib import Path

import pandas as pd

BACKEND = Path(__file__).resolve().parent.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import similarity_engine as se  # noqa: E402

# (title, field, status, office, pub_date, app_no)
ROWS = [
    ("Solar powered water pump for irrigation", "ENGINEERING", "Published", "Delhi", "2020-03-06", "A1"),
    ("Solar powered water pump for irrigation", "ENGINEERING", "Granted", "Delhi", "2022-08-12", "A1"),
    ("Solar powered water pump for irrigation", "ENGINEERING", "Published", "Mumbai", "2018-01-05", "A2"),
    ("Solar panel cleaning robot", "ELECTRONICS", "Published", "Chennai", "2021-06-11", "A3"),
    ("Wireless communication system using neural networks", "COMMUNICATION", "Published", "Delhi", "2019-09-20", "A4"),
    ("Neural network based image classification", "COMPUTER", "Granted", "Kolkata", "2023-02-17", "A5"),
    ("Herbal composition for treating diabetes", "PHARMACEUTICAL", "Published", "Mumbai", "2017-04-21", "A6"),
    ("Herbal tea composition", "FOOD", "Published", "Chennai", "2016-12-30", "A7"),
    ("Battery management for electric vehicles", "ELECTRICAL", "Granted", "Delhi", "2024-05-03", "A8"),
    ("Lithium batteries with improved charging", "ELECTRICAL", "Published", "Delhi", "2022-11-25", "A9"),
    ("Method and system", "NA", "Published", "Delhi", "2020-01-01", "A10"),   # all boilerplate -> no terms
    ("Irrigation controller with soil moisture sensor", "AGRICULTURE", "Published", "Mumbai", "2021-07-09", "A11"),
]


def make_df() -> pd.DataFrame:
    return pd.DataFrame({
        "PUBLICATION_NUMBER": [f"{i + 1}/2020" for i in range(len(ROWS))],
        "PUBLICATION_DATE": [r[4] for r in ROWS],
        "IPO_LOCATION": [r[3] for r in ROWS],
        "APPLICATION_NUMBER": [r[5] for r in ROWS],
        "DATE_OF_FILING": ["2015-01-01"] * len(ROWS),
        "TITLE_OF_INVENTION": [r[0] for r in ROWS],
        "FIELD_OF_INVENTION": [r[1] for r in ROWS],
        "PATENT_STATUS": [r[2] for r in ROWS],
    })


def make_index(cache_path=None, log=lambda m: None) -> "se.SimilarityIndex":
    return se.SimilarityIndex.from_dataframe(make_df(), cache_path, log)
