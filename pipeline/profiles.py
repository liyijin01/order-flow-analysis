from __future__ import annotations

from collections import defaultdict


def merge_days(days, parse_day):
    total = defaultdict(lambda: [0.0, 0.0])
    ok = []
    for day in days:
        ladder = parse_day(day)
        if ladder is None:
            continue
        ok.append(day.isoformat())
        for key, (buy, sell) in ladder.items():
            total[key][0] += buy
            total[key][1] += sell
    rows = [[key, round(value[0], 8), round(value[1], 8)] for key, value in sorted(total.items())]
    return ok, rows
