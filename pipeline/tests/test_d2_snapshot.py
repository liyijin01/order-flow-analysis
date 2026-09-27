from __future__ import annotations

import unittest
from datetime import datetime, timezone

from scripts.c4_1_golden import Bar
from scripts.d1_build_snapshot import aggregate_weekly

DAY=86_400_000


def day_ms(y,m,d):
    return int(datetime(y,m,d,tzinfo=timezone.utc).timestamp()*1000)


class AggregateWeeklyTests(unittest.TestCase):
    def test_monday_anchor_and_ohlcv_delta_sum(self):
        start=day_ms(2026,9,14)  # Monday
        bars=[]
        for i in range(7):
            bars.append(Bar(
                open_time=start+i*DAY,
                open=100+i,
                high=110+i,
                low=90-i,
                close=105+i,
                volume=10+i,
                taker_buy_base=4+i,
            ))
        out=aggregate_weekly(bars)
        self.assertEqual(len(out),1)
        w=out[0]
        self.assertEqual(w.open_time,start)
        self.assertEqual(w.open,100)
        self.assertEqual(w.close,111)
        self.assertEqual(w.high,116)
        self.assertEqual(w.low,84)
        self.assertEqual(w.volume,sum(10+i for i in range(7)))
        self.assertEqual(w.taker_buy_base,sum(4+i for i in range(7)))

    def test_incomplete_week_is_dropped(self):
        start=day_ms(2026,9,14)
        bars=[Bar(start+i*DAY,100,101,99,100,10,5) for i in range(6)]
        self.assertEqual(aggregate_weekly(bars),[])

    def test_gap_inside_week_is_dropped(self):
        start=day_ms(2026,9,14)
        bars=[Bar(start+i*DAY,100,101,99,100,10,5) for i in range(7) if i!=3]
        bars.append(Bar(start+7*DAY,100,101,99,100,10,5))
        self.assertEqual(aggregate_weekly(bars),[])


if __name__=="__main__":
    unittest.main()
