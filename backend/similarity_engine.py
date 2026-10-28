"""
PatentIQ backend - Phase 3: title-based similar patent search (engine).

What this does
--------------
Given a free-text invention description, find patent *records* whose TITLES
use similar words, rank them, and explain every match.

What this is NOT
----------------
The dataset holds metadata and titles only - no abstracts, claims or
descriptions. A score here is lexical (word-overlap) similarity between the
user's text and a title. It is NOT a novelty search, NOT a prior-art search and
NOT a patentability or freedom-to-operate opinion. Synonyms are not understood
("car" will not match "automobile").

How it works
------------
* Each distinct title (686k of the 751,100 records) is tokenised, lightly
  stemmed (plurals only), stripped of English + patent boilerplate stop-words
  ("method", "system", "apparatus"...), and turned into a SPARSE TF-IDF vector
  made of two blocks: unigrams (weight 0.7) and adjacent-word pairs (0.3).
  Every row is L2-normalised, so cosine similarity == dot product.
* The matrix is stored as a scipy CSR matrix (float32). Nothing dense of
  records x vocabulary is ever created.
* A query is vectorised with the SAME vocabulary / idf, then scored with one
  sparse (1 x F) @ (F x N) product that only touches the posting lists of the
  query's own terms.
* The score decomposes exactly: score = sum over shared features of
  (query weight x title weight). Those per-feature contributions are what the
  API returns as the explanation, so the number is fully auditable.
* The index is built once (background thread at startup, or on first use),
  cached on disk under backend/cache/, and reused across restarts.

This module deliberately has no FastAPI / pydantic imports so it can be tested
on its own. similarity_api.py is the thin HTTP layer on top.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import threading
import time
from collections import Counter
from functools import lru_cache
from pathlib import Path
from typing import Optional

import joblib
import numpy as np
import pandas as pd
from scipy import sparse
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, TfidfVectorizer

BASE_DIR = Path(__file__).resolve().parent
DATASET_PATH = BASE_DIR / "data" / "patents_combined.csv"
CACHE_DIR = BASE_DIR / "cache"

INDEX_VERSION = 1  # bump to invalidate every on-disk cache

# ---------------------------------------------------------------- limits
MAX_DESCRIPTION_CHARS = 2000
MIN_MEANINGFUL_TERMS = 1
MAX_QUERY_TERMS = 60          # distinct unigrams kept from a long description
DEFAULT_TOP_K = 10
MAX_TOP_K = 50
DEFAULT_MIN_SCORE = 0.05
DEFAULT_MAX_PER_TITLE = 3
MAX_MAX_PER_TITLE = 10
MAX_SCAN_TITLES = 20_000      # ranked titles examined when filters are active
MAX_BREAKDOWN_TERMS = 8       # per-result contribution rows returned
CACHE_MAX_ENTRIES = 256       # LRU of finished query results

UNIGRAM_WEIGHT = 0.7          # share of the score from single words
BIGRAM_WEIGHT = 1.0 - UNIGRAM_WEIGHT

# thresholds for the human-readable label only; ranking uses the raw score
STRENGTH_BANDS = ((0.60, "high overlap"), (0.35, "moderate overlap"),
                  (0.15, "low overlap"), (0.0, "very low overlap"))

DISCLAIMER = (
    "Scores measure how much your text overlaps with patent TITLES only. "
    "They are not a novelty, prior-art, patentability or freedom-to-operate "
    "assessment, and similar titles may describe very different inventions."
)

# ---------------------------------------------------------------- text
# Words that say nothing about WHAT is invented. Removed from the index and
# from queries so they can neither inflate scores nor appear as "concepts".
_BOILERPLATE = {
    "method", "methods", "system", "systems", "apparatus", "apparatuses",
    "device", "devices", "process", "processes", "thereof", "therefor",
    "therefore", "using", "use", "used", "uses", "based", "improved",
    "improvement", "improvements", "novel", "new", "present", "invention",
    "inventions", "related", "relating", "relates", "comprising", "comprises",
    "including", "include", "includes", "provide", "provides", "providing",
    "type", "types", "kind", "means", "thereby", "wherein", "herein",
    "various", "particular", "specific", "improving", "enhanced", "enhancing",
    # conversational filler found in free-text idea descriptions
    "want", "wants", "like", "idea", "ideas", "would", "could", "should",
    "make", "makes", "made", "making", "build", "builds", "built", "help",
    "helps", "helping", "allow", "allows", "allowing", "need", "needs",
    "something", "thing", "things", "way", "ways", "also", "can", "will",
    "create", "creating", "created", "design", "designing", "designed",
    "develop", "developing", "developed", "propose", "proposed",
}
_STOP = set(ENGLISH_STOP_WORDS) | _BOILERPLATE

_TOKEN_RE = re.compile(r"[a-z][a-z0-9]+|[0-9]+[a-z][a-z0-9]*")


@lru_cache(maxsize=300_000)
def _stem(word: str) -> str:
    """Plural-only normalisation, so batteries/battery and pumps/pump agree."""
    n = len(word)
    if n > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if n > 4 and word.endswith(("sses", "xes", "ches", "shes")):
        return word[:-2]
    if n > 3 and word.endswith("s") and not word.endswith(("ss", "us", "is")):
        return word[:-1]
    return word


def tokenize(text: str) -> list[tuple[str, str]]:
    """-> [(stem, surface_form), ...] for meaningful words, in order."""
    out = []
    for w in _TOKEN_RE.findall((text or "").lower()):
        if w in _STOP:
            continue
        s = _stem(w)
        if s in _STOP or len(s) < 2:
            continue
        out.append((s, w))
    return out


def _stems(text: str) -> list[str]:
    return [s for s, _ in tokenize(text)]


def _bigrams(stems: list[str]) -> list[str]:
    """Adjacent pairs of meaningful words (stop-words are skipped first)."""
    return [f"{a} {b}" for a, b in zip(stems, stems[1:]) if a != b]


class SimilarityError(Exception):
    """Raised for bad input; carries an HTTP-style status for the API layer."""

    def __init__(self, status: int, message: str, **extra):
        super().__init__(message)
        self.status = status
        self.detail = {"error": message, **extra} if extra else message


# ---------------------------------------------------------------- index
def _signature(titles: pd.Index | np.ndarray, n_rows: int) -> str:
    """Cheap content fingerprint (not mtime-based, so copies stay valid)."""
    h = hashlib.sha1()
    h.update(f"v{INDEX_VERSION}|{n_rows}|{len(titles)}".encode())
    for t in list(titles[:: max(1, len(titles) // 997)]):
        h.update(str(t).encode("utf-8", "replace"))
    return h.hexdigest()


class SimilarityIndex:
    """Sparse TF-IDF index over distinct patent titles + record lookup tables."""

    def __init__(self):
        self.ready = False

    # ------------------------------------------------------------ build
    @classmethod
    def from_dataframe(cls, df: pd.DataFrame, cache_path: Optional[Path] = None,
                       log=lambda m: None) -> "SimilarityIndex":
        """df needs: PUBLICATION_NUMBER, PUBLICATION_DATE, IPO_LOCATION,
        APPLICATION_NUMBER, DATE_OF_FILING, TITLE_OF_INVENTION,
        FIELD_OF_INVENTION, PATENT_STATUS (all strings)."""
        self = cls()
        t0 = time.time()
        n_rows = len(df)

        codes, titles = pd.factorize(df["TITLE_OF_INVENTION"].astype(str).str.strip())
        self.titles = np.asarray(titles, dtype=object)          # distinct display titles
        self.row_title = codes.astype(np.int32)                  # record -> title id
        n_titles = len(self.titles)

        # record -> title lookup (CSR-style: rows of title t = order[off[t]:off[t+1]])
        order = np.argsort(self.row_title, kind="stable").astype(np.int32)
        counts = np.bincount(self.row_title, minlength=n_titles)
        self.order = order
        self.off = np.concatenate([[0], np.cumsum(counts)]).astype(np.int64)

        # compact per-record columns
        self.fields = pd.Categorical(df["FIELD_OF_INVENTION"].astype(str).str.strip())
        self.statuses = pd.Categorical(df["PATENT_STATUS"].astype(str).str.strip())
        self.offices = pd.Categorical(df["IPO_LOCATION"].astype(str).str.strip())
        self.pub_numbers = pd.Categorical(df["PUBLICATION_NUMBER"].astype(str).str.strip())
        self.pub_dates = pd.Categorical(df["PUBLICATION_DATE"].astype(str).str.strip())
        self.filing_dates = pd.Categorical(df["DATE_OF_FILING"].astype(str).str.strip())
        self.app_numbers = df["APPLICATION_NUMBER"].astype(str).str.strip().to_numpy(dtype=object)
        year = pd.to_numeric(df["PUBLICATION_DATE"].astype(str).str[:4], errors="coerce")
        self.years = year.fillna(0).to_numpy(dtype=np.int16)
        self.n_rows = n_rows
        # integer sort key so records can be ordered newest-first without 751k strings
        cats = np.asarray(self.pub_dates.categories.astype(str))
        rank = np.empty(len(cats), dtype=np.int32)
        rank[np.argsort(cats, kind="stable")] = np.arange(len(cats), dtype=np.int32)
        self._date_key = rank[self.pub_dates.codes]

        sig = _signature(self.titles, n_rows)
        loaded = self._try_load_cache(cache_path, sig, n_titles, log)
        if not loaded:
            log(f"tokenising {n_titles:,} distinct titles ...")
            uni_docs = [_stems(t) for t in self.titles]
            bi_docs = [_bigrams(d) for d in uni_docs]

            log("fitting unigram TF-IDF ...")
            uv = TfidfVectorizer(analyzer=lambda x: x, min_df=1, sublinear_tf=True,
                                 norm="l2", dtype=np.float32)
            U = uv.fit_transform(uni_docs)
            log("fitting bigram TF-IDF (min_df=2) ...")
            bv = TfidfVectorizer(analyzer=lambda x: x, min_df=2, sublinear_tf=True,
                                 norm="l2", dtype=np.float32)
            B = bv.fit_transform(bi_docs)
            del uni_docs, bi_docs

            self.uni_vocab = dict(uv.vocabulary_)
            self.uni_idf = uv.idf_.astype(np.float32)
            self.bi_vocab = dict(bv.vocabulary_)
            self.bi_idf = bv.idf_.astype(np.float32)
            self.X = self._combine(U.tocsr(), B.tocsr())
            self._save_cache(cache_path, sig, log)

        self._finish()
        log(f"index ready: {n_titles:,} titles, {self.X.shape[1]:,} features, "
            f"{self.X.nnz:,} non-zeros, {time.time() - t0:.1f}s")
        return self

    @staticmethod
    def _combine(U: sparse.csr_matrix, B: sparse.csr_matrix) -> sparse.csr_matrix:
        """[sqrt(a)*U | sqrt(1-a)*B] per row; rows with no bigrams keep U at 1.0
        so every non-empty row stays unit-length."""
        has_bi = np.diff(B.indptr) > 0
        su = np.where(has_bi, math.sqrt(UNIGRAM_WEIGHT), 1.0).astype(np.float32)
        sb = np.full(B.shape[0], math.sqrt(BIGRAM_WEIGHT), dtype=np.float32)
        X = sparse.hstack([sparse.diags(su) @ U, sparse.diags(sb) @ B], format="csr",
                          dtype=np.float32)
        X.sort_indices()
        return X

    def _finish(self):
        self.n_uni = len(self.uni_vocab)
        self.uni_terms = _invert(self.uni_vocab)
        self.bi_terms = _invert(self.bi_vocab)
        self.XT = self.X.T.tocsr()          # features x titles: posting lists
        self.field_names = [str(c) for c in self.fields.categories]
        self.status_names = [str(c) for c in self.statuses.categories]
        self.office_names = [str(c) for c in self.offices.categories]
        self.ready = True

    # ------------------------------------------------------------ cache
    def _try_load_cache(self, path, sig, n_titles, log) -> bool:
        if path is None:
            return False
        meta, mat = Path(path) / "meta.joblib", Path(path) / "matrix.npz"
        if not (meta.exists() and mat.exists()):
            return False
        try:
            m = joblib.load(meta)
            if m.get("signature") != sig or m.get("version") != INDEX_VERSION:
                log("index cache is stale - rebuilding")
                return False
            X = sparse.load_npz(mat).tocsr()
            if X.shape[0] != n_titles:
                return False
            self.X = X
            self.uni_vocab, self.uni_idf = m["uni_vocab"], m["uni_idf"]
            self.bi_vocab, self.bi_idf = m["bi_vocab"], m["bi_idf"]
            log("loaded index from disk cache")
            return True
        except Exception as exc:  # corrupt cache must never break startup
            log(f"index cache unreadable ({exc}) - rebuilding")
            return False

    def _save_cache(self, path, sig, log):
        if path is None:
            return
        try:
            path = Path(path)
            path.mkdir(parents=True, exist_ok=True)
            sparse.save_npz(path / "matrix.npz", self.X, compressed=False)
            joblib.dump({"version": INDEX_VERSION, "signature": sig,
                         "uni_vocab": self.uni_vocab, "uni_idf": self.uni_idf,
                         "bi_vocab": self.bi_vocab, "bi_idf": self.bi_idf},
                        path / "meta.joblib")
            log(f"index cached to {path}")
        except OSError as exc:
            log(f"could not write index cache: {exc}")

    # ------------------------------------------------------------ query
    def vectorise(self, text: str):
        """-> (1xF CSR query vector, info). Mirrors the document pipeline."""
        toks = tokenize(text)
        surface: dict[str, str] = {}
        for s, w in toks:
            surface.setdefault(s, w)
        stems = [s for s, _ in toks]

        uni_counts = Counter(stems)
        if len(uni_counts) > MAX_QUERY_TERMS:           # keep the rarest (most informative)
            keep = sorted(uni_counts, key=lambda s: -self.uni_idf[self.uni_vocab[s]]
                          if s in self.uni_vocab else 0.0)[:MAX_QUERY_TERMS]
            kept = set(keep)
            stems = [s for s in stems if s in kept]
            uni_counts = Counter(stems)
        bi_counts = Counter(_bigrams(stems))

        def block(counts, vocab, idf):
            idx, val = [], []
            for term, c in counts.items():
                j = vocab.get(term)
                if j is not None:
                    idx.append(j)
                    val.append((1.0 + math.log(c)) * float(idf[j]))
            if not idx:
                return np.array([], dtype=np.int64), np.array([], dtype=np.float32)
            val = np.asarray(val, dtype=np.float32)
            return np.asarray(idx, dtype=np.int64), val / np.linalg.norm(val)

        ui, uv = block(uni_counts, self.uni_vocab, self.uni_idf)
        bi, bv = block(bi_counts, self.bi_vocab, self.bi_idf)
        su = math.sqrt(UNIGRAM_WEIGHT) if len(bi) else 1.0
        cols = np.concatenate([ui, bi + self.n_uni])
        vals = np.concatenate([uv * su, bv * math.sqrt(BIGRAM_WEIGHT)]).astype(np.float32)
        q = sparse.csr_matrix((vals, (np.zeros(len(cols), dtype=np.int64), cols)),
                              shape=(1, self.X.shape[1]), dtype=np.float32)
        info = {
            "terms": list(uni_counts),                       # all meaningful stems
            "unknown_terms": [surface[s] for s in uni_counts if s not in self.uni_vocab],
            "surface": surface,
        }
        return q, info

    # ------------------------------------------------------------ search
    def search(self, description: str, *, top_k=DEFAULT_TOP_K, field=None, status=None,
               office=None, year_from=None, year_to=None, min_score=DEFAULT_MIN_SCORE,
               max_per_title=DEFAULT_MAX_PER_TITLE) -> dict:
        t0 = time.perf_counter()
        p = self._validate(description, top_k, field, status, office, year_from, year_to,
                           min_score, max_per_title)
        q, info = self.vectorise(p["description"])
        if not info["terms"]:
            raise SimilarityError(
                422, "The description has no searchable terms. Use English words that "
                     "describe what the invention is or does (not only numbers, symbols, "
                     "or generic words like 'method' or 'system').")
        if q.nnz == 0:
            return self._response(p, info, q, [], 0, False, t0, note=(
                "None of your terms appear in any patent title in the dataset, so "
                "nothing can be matched. Try different or more common wording."))

        scores_row = (q @ self.XT).tocoo()               # touches only the query's postings
        tid = scores_row.col.astype(np.int64)
        sc = scores_row.data.astype(np.float64)
        total_titles = int(len(tid))
        if total_titles:
            keep = sc >= p["min_score"]
            tid, sc = tid[keep], sc[keep]
        order = np.lexsort((tid, -sc))                    # score desc, then title id (deterministic)
        tid, sc = tid[order], sc[order]
        qvec = {int(c): float(v) for c, v in zip(q.indices, q.data)}

        masks = self._row_filters(p)
        results, scanned, truncated = [], 0, False
        for t, s in zip(tid, sc):
            if len(results) >= p["top_k"]:
                break
            if scanned >= MAX_SCAN_TITLES and masks:
                truncated = True
                break
            scanned += 1
            rows = self.order[self.off[t]:self.off[t + 1]]
            if masks:
                ok = np.ones(len(rows), dtype=bool)
                for arr, allowed in masks:
                    ok &= allowed(arr[rows])
                rows = rows[ok]
            if not len(rows):
                continue
            n_same = int(len(rows))
            rows = sorted(rows, key=lambda r: (int(self._date_key[r]), -int(r)), reverse=True)
            for r in rows[:p["max_per_title"]]:
                if len(results) >= p["top_k"]:
                    break
                results.append(self._record(int(r), int(t), float(s), qvec, info, n_same))
        for i, r in enumerate(results, 1):
            r["rank"] = i
        note = None
        if truncated:
            note = (f"Filters are narrow: only the {MAX_SCAN_TITLES:,} best-ranked titles were "
                    "checked against them, so lower-ranked matches may be missing. Loosen a "
                    "filter or add detail to the description.")
        elif not results and total_titles:
            note = ("Titles share words with your description, but none reached min_score "
                    f"({p['min_score']}) within the selected filters. Try lowering min_score "
                    "or loosening the filters.")
        return self._response(p, info, q, results, total_titles, truncated, t0, note=note)

    # ------------------------------------------------------------ helpers
    def _validate(self, description, top_k, field, status, office, year_from, year_to,
                  min_score, max_per_title) -> dict:
        if not isinstance(description, str):
            raise SimilarityError(422, "description must be a string")
        description = description.strip()
        if not description:
            raise SimilarityError(400, "description must not be empty")
        if len(description) > MAX_DESCRIPTION_CHARS:
            raise SimilarityError(
                422, f"description is too long ({len(description)} chars); "
                     f"the limit is {MAX_DESCRIPTION_CHARS}")

        def as_int(name, v, lo, hi):
            if isinstance(v, bool) or not isinstance(v, (int, np.integer)):
                raise SimilarityError(422, f"{name} must be an integer")
            if not lo <= v <= hi:
                raise SimilarityError(422, f"{name} must be between {lo} and {hi}")
            return int(v)

        top_k = as_int("top_k", top_k, 1, MAX_TOP_K)
        max_per_title = as_int("max_per_title", max_per_title, 1, MAX_MAX_PER_TITLE)
        if isinstance(min_score, bool) or not isinstance(min_score, (int, float)) \
                or math.isnan(min_score) or not 0.0 <= min_score <= 1.0:
            raise SimilarityError(422, "min_score must be a number between 0 and 1")
        if year_from is not None:
            year_from = as_int("year_from", year_from, 1800, 2200)
        if year_to is not None:
            year_to = as_int("year_to", year_to, 1800, 2200)
        if year_from is not None and year_to is not None and year_from > year_to:
            raise SimilarityError(422, "year_from must not be greater than year_to")

        def canon(kind, value, allowed):
            if value is None or (isinstance(value, str) and not value.strip()):
                return None
            if not isinstance(value, str):
                raise SimilarityError(422, f"{kind} must be a string")
            for a in allowed:
                if a.casefold() == value.strip().casefold():
                    return a
            raise SimilarityError(422, f"Unknown {kind}: {value!r}", allowed=sorted(allowed))

        return {
            "description": description, "top_k": top_k, "min_score": float(min_score),
            "max_per_title": max_per_title, "year_from": year_from, "year_to": year_to,
            "field": canon("field", field, self.field_names),
            "status": canon("status", status, self.status_names),
            "office": canon("office", office, self.office_names),
        }

    def _row_filters(self, p):
        """-> [(per-record array, predicate)] for the active filters only."""
        m = []
        for key, cat, names in (("field", self.fields, self.field_names),
                                ("status", self.statuses, self.status_names),
                                ("office", self.offices, self.office_names)):
            if p[key] is not None:
                code = names.index(p[key])
                m.append((cat.codes, (lambda c: lambda a: a == c)(code)))
        if p["year_from"] is not None:
            m.append((self.years, (lambda y: lambda a: a >= y)(p["year_from"])))
        if p["year_to"] is not None:
            m.append((self.years, (lambda y: lambda a: (a <= y) & (a > 0))(p["year_to"])))
        return m

    def _record(self, r: int, t: int, score: float, qvec: dict, info: dict, n_same: int) -> dict:
        d = self.X[t]
        dvec = dict(zip(d.indices.tolist(), d.data.tolist()))
        shared = sorted(set(qvec) & set(dvec))
        parts = []
        for j in shared:
            is_uni = j < self.n_uni
            term = self.uni_terms[j] if is_uni else self.bi_terms[j - self.n_uni]
            idf = float(self.uni_idf[j] if is_uni else self.bi_idf[j - self.n_uni])
            c = qvec[j] * dvec[j]
            label = " ".join(info["surface"].get(w, w) for w in term.split())
            parts.append({"term": label, "kind": "word" if is_uni else "phrase",
                          "query_weight": round(qvec[j], 4), "title_weight": round(dvec[j], 4),
                          "contribution": round(c, 4), "idf": round(idf, 2)})
        parts.sort(key=lambda x: -x["contribution"])
        total = sum(x["contribution"] for x in parts) or 1.0
        for x in parts:
            x["share_of_score"] = round(x["contribution"] / total, 3)

        words = [x["term"] for x in parts if x["kind"] == "word"]
        phrases = [x["term"] for x in parts if x["kind"] == "phrase"]
        n_q = len(info["terms"])
        n_title = int((d.indices < self.n_uni).sum())
        cov_q = len(words) / n_q if n_q else 0.0
        cov_t = len(words) / n_title if n_title else 0.0
        return {
            "publication_number": str(self.pub_numbers[r]),
            "application_number": str(self.app_numbers[r]),
            "title": " ".join(str(self.titles[t]).split()),   # some titles contain newlines
            "field": str(self.fields[r]),
            "office": str(self.offices[r]),
            "publication_date": str(self.pub_dates[r]),
            "filing_date": str(self.filing_dates[r]),
            "status": str(self.statuses[r]),
            "similarity_score": round(score, 4),
            "match_strength": _strength(score, len(words), cov_q, cov_t),
            "shared_concepts": words,
            "shared_phrases": phrases,
            "query_term_coverage": round(cov_q, 3),
            "title_term_coverage": round(cov_t, 3),
            "score_breakdown": parts[:MAX_BREAKDOWN_TERMS],
            "explanation": _explain(score, words, phrases, parts, n_q, n_title),
            "records_with_this_title": n_same,
        }

    def _response(self, p, info, q, results, total_titles, truncated, t0, note=None) -> dict:
        idf = lambda s: float(self.uni_idf[self.uni_vocab[s]])
        known = [s for s in info["terms"] if s in self.uni_vocab]
        qterms = sorted(
            ({"term": info["surface"][s], "idf": round(idf(s), 2)} for s in known),
            key=lambda x: -x["idf"])
        return {
            "query": {
                "description": p["description"],
                "key_terms": qterms,
                "terms_not_in_dataset": info["unknown_terms"],
                "filters": {k: p[k] for k in ("field", "status", "office", "year_from", "year_to")
                            if p[k] is not None},
                "top_k": p["top_k"], "min_score": p["min_score"],
                "max_per_title": p["max_per_title"],
            },
            "titles_with_any_overlap": total_titles,
            "returned": len(results),
            "scan_truncated": truncated,
            "results": results,
            "note": note,
            "method": {
                "type": "title-only TF-IDF cosine similarity (sparse)",
                "score_range": "0.0 (no shared terms) to 1.0 (identical weighted terms)",
                "weights": {"single_words": UNIGRAM_WEIGHT, "word_pairs": BIGRAM_WEIGHT},
                "ignored": "common English words and patent boilerplate such as "
                           "'method', 'system', 'apparatus'",
                "ranking": "score descending; identical titles grouped, newest records first",
                "indexed_titles": int(self.X.shape[0]),
                "indexed_records": int(self.n_rows),
            },
            "elapsed_ms": round((time.perf_counter() - t0) * 1000, 1),
            "disclaimer": DISCLAIMER,
        }


def _strength(score: float, n_shared_words: int, cov_q: float, cov_t: float) -> str:
    """Label from the score, but a match on a single shared word can never read
    'high' unless the query and title are made of exactly that one word."""
    label = next(lbl for th, lbl in STRENGTH_BANDS if score >= th)
    if label == "high overlap" and n_shared_words < 2 and not (cov_q == 1.0 and cov_t == 1.0):
        return "moderate overlap"
    return label


def _invert(vocab: dict) -> list:
    out = [None] * len(vocab)
    for term, j in vocab.items():
        out[j] = term
    return out


def _explain(score, words, phrases, parts, n_q, n_title) -> str:
    if not parts:
        return "No shared terms."
    top = parts[0]
    bits = [f"Shares {len(words)} of your {n_q} key term(s)"
            + (f" ({', '.join(words[:5])}{'...' if len(words) > 5 else ''})" if words else "")]
    if phrases:
        bits.append(f"and the word pair{'s' if len(phrases) > 1 else ''} "
                    + ", ".join(f"'{x}'" for x in phrases[:3]))
    rarity = "a rare" if top["idf"] >= 7 else "a fairly common" if top["idf"] < 5 else "an uncommon"
    bits.append(f"- '{top['term']}' ({rarity} term in titles) contributes the most, "
                f"{round(top['share_of_score'] * 100)}% of the score")
    return (" ".join(bits) + f". Score {score:.2f} = title-only word overlap, "
            "not a measure of novelty or patentability.")


# ---------------------------------------------------------------- singleton
_COLUMNS = ["PUBLICATION_NUMBER", "PUBLICATION_DATE", "IPO_LOCATION", "APPLICATION_NUMBER",
            "DATE_OF_FILING", "TITLE_OF_INVENTION", "FIELD_OF_INVENTION", "PATENT_STATUS"]


class IndexManager:
    """Builds the index once, in the background, and tracks its state."""

    def __init__(self, csv_path: Path = DATASET_PATH, cache_dir: Path = CACHE_DIR):
        self.csv_path, self.cache_dir = Path(csv_path), Path(cache_dir)
        self._lock = threading.Lock()
        self._index: Optional[SimilarityIndex] = None
        self.state = "not_started"          # not_started | building | ready | failed
        self.error: Optional[str] = None
        self.started_at = self.finished_at = None
        self.last_log = ""
        self._qcache: dict = {}
        self._qlock = threading.Lock()

    def _log(self, msg):
        self.last_log = msg
        print(f"[similarity] {msg}")

    def start(self, wait=False):
        """Idempotent. Starts a background build unless one is running/finished."""
        with self._lock:
            if self.state in ("building", "ready"):
                t = None
            else:
                self.state, self.error = "building", None
                self.started_at, self.finished_at = time.time(), None
                t = threading.Thread(target=self._build, daemon=True, name="similarity-build")
                t.start()
        if wait and t is not None:
            t.join()
        return self.state

    def _build(self):
        try:
            if not self.csv_path.exists():
                raise FileNotFoundError(f"Patent dataset not found: {self.csv_path}")
            df = pd.read_csv(self.csv_path, usecols=lambda c: c in _COLUMNS, dtype=str,
                             keep_default_na=False, encoding="utf-8-sig")
            missing = set(_COLUMNS) - set(df.columns)
            if missing:
                raise ValueError(f"Dataset is missing required columns: {sorted(missing)}")
            idx = SimilarityIndex.from_dataframe(df, self.cache_dir / "similarity_v1", self._log)
            del df
            with self._lock:
                self._index, self.state = idx, "ready"
        except Exception as exc:
            with self._lock:
                self.state, self.error = "failed", f"{type(exc).__name__}: {exc}"
            self._log(f"build failed: {self.error}")
        finally:
            self.finished_at = time.time()

    def set_index(self, idx: SimilarityIndex):
        """Inject a prebuilt index (used by tests)."""
        with self._lock:
            self._index, self.state, self.error = idx, "ready", None
        self.clear_cache()

    def clear_cache(self):
        with self._qlock:
            self._qcache.clear()

    def status(self) -> dict:
        s = {"state": self.state, "error": self.error}
        if self._index is not None:
            s.update(indexed_titles=int(self._index.X.shape[0]),
                     indexed_records=int(self._index.n_rows),
                     features=int(self._index.X.shape[1]),
                     non_zeros=int(self._index.X.nnz),
                     matrix_mb=round((self._index.X.data.nbytes + self._index.X.indices.nbytes
                                      + self._index.X.indptr.nbytes) / 1e6, 1))
        if self.state == "building" and self.started_at:
            s["building_for_s"] = round(time.time() - self.started_at, 1)
            s["progress"] = self.last_log
        s["cached_queries"] = len(self._qcache)
        return s

    def search(self, description, **kw) -> dict:
        """Cached search. Raises SimilarityError(503) while the index isn't ready."""
        if self.state == "not_started":
            self.start()
        if self.state == "failed":
            raise SimilarityError(503, f"Similarity index unavailable: {self.error}")
        if self.state != "ready":
            raise SimilarityError(503, "Similarity index is still being built; retry shortly.",
                                  retry_after_seconds=5)
        # normalise the key so trivially different requests share a cache entry
        key = (" ".join(str(description).split()).casefold(),
               tuple(sorted((k, v if not isinstance(v, str) else v.strip().casefold())
                            for k, v in kw.items())))
        with self._qlock:
            hit = self._qcache.get(key)
            if hit is not None:                              # refresh recency (true LRU)
                self._qcache[key] = self._qcache.pop(key)
        if hit is not None:
            out = dict(hit)
            out["cache_hit"] = True
            return out
        out = self._index.search(description, **kw)       # raises SimilarityError on bad input
        out["cache_hit"] = False
        with self._qlock:
            if len(self._qcache) >= CACHE_MAX_ENTRIES:
                self._qcache.pop(next(iter(self._qcache)))   # drop oldest
            self._qcache[key] = out
        return out

    def filter_options(self) -> dict:
        if self.state != "ready":
            raise SimilarityError(503, "Similarity index is not ready")
        i = self._index
        return {"field": sorted(i.field_names), "status": sorted(i.status_names),
                "office": sorted(i.office_names)}


manager = IndexManager()
