"""
Engine-level tests for similarity_engine.py (no FastAPI needed).

Run from backend/ with either:
    python -m unittest discover -s tests -p "test_similarity_engine.py" -v
    python -m pytest tests/test_similarity_engine.py -v
"""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import similarity_fixtures as fx  # noqa: E402

import similarity_engine as se  # noqa: E402


class TextProcessing(unittest.TestCase):
    def test_plural_stemming(self):
        self.assertEqual(se._stem("batteries"), "battery")
        self.assertEqual(se._stem("pumps"), "pump")
        self.assertEqual(se._stem("glass"), "glass")

    def test_boilerplate_and_stopwords_removed(self):
        stems = [s for s, _ in se.tokenize("A method and system for using the apparatus")]
        self.assertEqual(stems, [])

    def test_bigrams_adjacent_only(self):
        self.assertEqual(se._bigrams(["solar", "pump", "water"]), ["solar pump", "pump water"])


class Search(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.idx = fx.make_index()

    def test_best_match_first_and_scores_sorted(self):
        r = self.idx.search("solar water pump for irrigation")
        self.assertGreater(r["returned"], 0)
        self.assertEqual(r["results"][0]["title"], "Solar powered water pump for irrigation")
        scores = [x["similarity_score"] for x in r["results"]]
        self.assertEqual(scores, sorted(scores, reverse=True))
        self.assertTrue(all(0.0 <= s <= 1.0 + 1e-6 for s in scores))
        self.assertEqual([x["rank"] for x in r["results"]], list(range(1, r["returned"] + 1)))

    def test_explanation_fields_present_and_consistent(self):
        top = self.idx.search("solar water pump")["results"][0]
        for k in ("shared_concepts", "shared_phrases", "score_breakdown", "explanation",
                  "match_strength", "query_term_coverage", "title_term_coverage"):
            self.assertIn(k, top)
        self.assertIn("solar", top["shared_concepts"])
        # breakdown contributions add up to the score (breakdown is capped, so <=)
        total = sum(p["contribution"] for p in top["score_breakdown"])
        self.assertAlmostEqual(total, top["similarity_score"], places=2)

    def test_identical_titles_grouped_and_capped(self):
        r = self.idx.search("solar powered water pump irrigation", max_per_title=2)
        same = [x for x in r["results"] if x["title"] == "Solar powered water pump for irrigation"]
        self.assertEqual(len(same), 2)
        self.assertEqual(same[0]["records_with_this_title"], 3)
        # newest record first within identical titles
        self.assertGreaterEqual(same[0]["publication_date"], same[1]["publication_date"])

    def test_top_k_respected(self):
        self.assertLessEqual(self.idx.search("solar", top_k=1)["returned"], 1)

    def test_filters(self):
        r = self.idx.search("solar water pump", status="granted")  # case-insensitive
        self.assertTrue(r["results"])
        self.assertTrue(all(x["status"] == "Granted" for x in r["results"]))
        r = self.idx.search("solar water pump", office="mumbai", year_to=2019)
        self.assertTrue(r["results"])
        self.assertTrue(all(x["office"] == "Mumbai" and x["publication_date"] <= "2019-12-31"
                            for x in r["results"]))
        r = self.idx.search("neural network", field="COMPUTER")
        self.assertEqual({x["field"] for x in r["results"]}, {"COMPUTER"})
        r = self.idx.search("batteries", year_from=2023)
        self.assertTrue(all(x["publication_date"] >= "2023-01-01" for x in r["results"]))

    def test_filters_with_no_match_gives_note_not_error(self):
        r = self.idx.search("herbal composition", field="COMPUTER")
        self.assertEqual(r["results"], [])
        self.assertIsNotNone(r["note"])

    def test_plural_query_matches_singular_title(self):
        r = self.idx.search("lithium battery")
        self.assertIn("Lithium batteries with improved charging", [x["title"] for x in r["results"]])

    def test_unknown_terms_reported(self):
        r = self.idx.search("solar zzyzxqq")
        self.assertIn("zzyzxqq", r["query"]["terms_not_in_dataset"])

    def test_no_overlap_returns_empty_with_note(self):
        r = self.idx.search("zzyzxqq blorptastic")
        self.assertEqual(r["results"], [])
        self.assertIn("None of your terms", r["note"])

    def test_deterministic(self):
        a = self.idx.search("neural network image")
        b = self.idx.search("neural network image")
        a.pop("elapsed_ms"), b.pop("elapsed_ms")
        self.assertEqual(a, b)

    def test_response_carries_disclaimer_and_method(self):
        r = self.idx.search("solar")
        self.assertEqual(r["disclaimer"], se.DISCLAIMER)
        self.assertEqual(r["method"]["indexed_records"], len(fx.ROWS))


class Validation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.idx = fx.make_index()

    def status(self, *a, **k):
        with self.assertRaises(se.SimilarityError) as cm:
            self.idx.search(*a, **k)
        return cm.exception.status

    def test_bad_input_statuses(self):
        self.assertEqual(self.status("   "), 400)
        self.assertEqual(self.status("x" * (se.MAX_DESCRIPTION_CHARS + 1)), 422)
        self.assertEqual(self.status("solar", top_k=0), 422)
        self.assertEqual(self.status("solar", top_k=se.MAX_TOP_K + 1), 422)
        self.assertEqual(self.status("solar", top_k=True), 422)
        self.assertEqual(self.status("solar", min_score=1.5), 422)
        self.assertEqual(self.status("solar", min_score=float("nan")), 422)
        self.assertEqual(self.status("solar", year_from=2022, year_to=2020), 422)
        self.assertEqual(self.status("solar", field="NOPE"), 422)
        self.assertEqual(self.status("method and system"), 422)   # only boilerplate
        self.assertEqual(self.status("12345 6789"), 422)           # only numbers

    def test_unknown_filter_lists_allowed_values(self):
        with self.assertRaises(se.SimilarityError) as cm:
            self.idx.search("solar", status="Pending")
        self.assertEqual(sorted(cm.exception.detail["allowed"]), ["Granted", "Published"])


class DiskCache(unittest.TestCase):
    def test_cache_written_reloaded_and_equivalent(self):
        with tempfile.TemporaryDirectory() as d:
            logs1, logs2 = [], []
            a = fx.make_index(Path(d) / "c", logs1.append)
            self.assertTrue((Path(d) / "c" / "matrix.npz").exists())
            self.assertFalse(any("loaded index from disk cache" in m for m in logs1))
            b = fx.make_index(Path(d) / "c", logs2.append)
            self.assertTrue(any("loaded index from disk cache" in m for m in logs2))
            ra, rb = a.search("solar water pump"), b.search("solar water pump")
            ra.pop("elapsed_ms"), rb.pop("elapsed_ms")
            self.assertEqual(ra, rb)

    def test_stale_cache_is_rebuilt(self):
        with tempfile.TemporaryDirectory() as d:
            fx.make_index(Path(d) / "c")
            df = fx.make_df()
            df.loc[0, "TITLE_OF_INVENTION"] = "Completely different title about turbines"
            logs = []
            idx = se.SimilarityIndex.from_dataframe(df, Path(d) / "c", logs.append)
            self.assertTrue(any("stale" in m for m in logs))
            self.assertEqual(idx.search("turbines")["results"][0]["title"],
                             "Completely different title about turbines")

    def test_corrupt_cache_does_not_break_build(self):
        with tempfile.TemporaryDirectory() as d:
            fx.make_index(Path(d) / "c")
            (Path(d) / "c" / "matrix.npz").write_bytes(b"not a real npz")
            idx = fx.make_index(Path(d) / "c")
            self.assertGreater(idx.search("solar")["returned"], 0)


class Manager(unittest.TestCase):
    def test_not_ready_raises_503(self):
        m = se.IndexManager(csv_path=Path("/nonexistent/x.csv"))
        m.state = "building"
        with self.assertRaises(se.SimilarityError) as cm:
            m.search("solar")
        self.assertEqual(cm.exception.status, 503)
        self.assertEqual(cm.exception.detail["retry_after_seconds"], 5)

    def test_missing_csv_ends_failed_with_503(self):
        m = se.IndexManager(csv_path=Path("/nonexistent/x.csv"))
        self.assertEqual(m.start(wait=True), "failed")
        self.assertIn("FileNotFoundError", m.error)
        with self.assertRaises(se.SimilarityError) as cm:
            m.search("solar")
        self.assertEqual(cm.exception.status, 503)

    def test_start_is_idempotent_when_ready(self):
        m = se.IndexManager()
        m.set_index(fx.make_index())
        self.assertEqual(m.start(), "ready")

    def test_query_cache_hit_and_normalised_key(self):
        m = se.IndexManager()
        m.set_index(fx.make_index())
        first = m.search("Solar   water pump", top_k=5)
        second = m.search("solar water PUMP", top_k=5)
        self.assertFalse(first["cache_hit"])
        self.assertTrue(second["cache_hit"])
        self.assertEqual(first["results"], second["results"])
        self.assertFalse(m.search("solar water pump", top_k=6)["cache_hit"])
        self.assertEqual(m.status()["cached_queries"], 2)

    def test_cache_eviction_is_lru(self):
        old = se.CACHE_MAX_ENTRIES
        se.CACHE_MAX_ENTRIES = 2
        try:
            m = se.IndexManager()
            m.set_index(fx.make_index())
            m.search("solar")
            m.search("battery")
            m.search("solar")              # refresh "solar"
            m.search("herbal")             # evicts "battery", not "solar"
            self.assertTrue(m.search("solar")["cache_hit"])
            self.assertFalse(m.search("battery")["cache_hit"])
        finally:
            se.CACHE_MAX_ENTRIES = old

    def test_set_index_clears_cache(self):
        m = se.IndexManager()
        m.set_index(fx.make_index())
        m.search("solar")
        m.set_index(fx.make_index())
        self.assertEqual(m.status()["cached_queries"], 0)

    def test_errors_are_not_cached(self):
        m = se.IndexManager()
        m.set_index(fx.make_index())
        with self.assertRaises(se.SimilarityError):
            m.search("method and system")
        self.assertEqual(m.status()["cached_queries"], 0)

    def test_status_and_filter_options(self):
        m = se.IndexManager()
        m.set_index(fx.make_index())
        s = m.status()
        self.assertEqual(s["state"], "ready")
        self.assertEqual(s["indexed_records"], len(fx.ROWS))
        self.assertIn("Delhi", m.filter_options()["office"])

    def test_background_build_from_csv(self):
        with tempfile.TemporaryDirectory() as d:
            csv = Path(d) / "p.csv"
            fx.make_df().to_csv(csv, index=False)
            m = se.IndexManager(csv_path=csv, cache_dir=Path(d) / "cache")
            self.assertEqual(m.start(wait=True), "ready")
            self.assertGreater(m.search("solar water pump")["returned"], 0)
            self.assertTrue((Path(d) / "cache" / "similarity_v1" / "matrix.npz").exists())


if __name__ == "__main__":
    unittest.main()
