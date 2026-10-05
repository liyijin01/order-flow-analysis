import unittest
from datetime import datetime, timezone

from scripts.d16_build_tpo import single_print_ranges, weekly_specs


class D17TpoTests(unittest.TestCase):
    def test_weekly_specs_are_completed_monday_utc_weeks(self):
        specs=weekly_specs(datetime(2026,10,1,12,tzinfo=timezone.utc),3)
        self.assertEqual([x["label"] for x in specs],["2026-09-07","2026-09-14","2026-09-21"])
        for row in specs:
            self.assertEqual(row["start"].weekday(),0)
            self.assertEqual((row["end"]-row["start"]).days,7)

    def test_single_prints_skip_edge_tails_and_require_three_rows(self):
        rows=[[0,1],[10,1],[20,2],[30,1],[40,1],[50,1],[60,2],[70,1],[80,1],[90,1]]
        self.assertEqual(single_print_ranges(rows,10,3),[[30.0,60.0]])

    def test_two_row_single_print_is_rejected(self):
        rows=[[0,2],[10,1],[20,1],[30,2]]
        self.assertEqual(single_print_ranges(rows,10,3),[])


if __name__=="__main__":
    unittest.main()
