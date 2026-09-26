import unittest
from datetime import date

from pipeline.profiles import build_period, combine_ladders


class ProfileTests(unittest.TestCase):
    def test_completeness_fields_show_missing_days(self):
        expected = [date(2026, 9, 21), date(2026, 9, 22), date(2026, 9, 23)]
        daily = {
            "2026-09-21": {"rows": [[1, 1, 2]]},
            "2026-09-23": {"rows": [[1, 3, 4]]},
        }
        p = build_period("test", expected, daily)
        self.assertFalse(p["complete"])
        self.assertEqual(p["expectedDays"], ["2026-09-21", "2026-09-22", "2026-09-23"])
        self.assertEqual(p["days"], ["2026-09-21", "2026-09-23"])
        self.assertEqual(p["missingDays"], ["2026-09-22"])
        self.assertEqual(p["rows"], [[1, 4.0, 6.0]])

    def test_seven_daily_ladders_equal_direct_sum(self):
        payloads = [{"rows": [[100, i, i * 2], [101, 1, 0]]} for i in range(1, 8)]
        rows = combine_ladders(payloads)
        self.assertEqual(rows, [[100, 28.0, 56.0], [101, 7.0, 0.0]])


if __name__ == "__main__":
    unittest.main()
