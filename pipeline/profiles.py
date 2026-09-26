from __future__ import annotations

from collections import defaultdict
from decimal import Decimal


def combine_ladders(payloads: list[dict]) -> list[list]:
    total = defaultdict(lambda: [Decimal("0"), Decimal("0")])
    for payload in payloads:
        for index, buy, sell in payload.get("rows", []):
            total[int(index)][0] += Decimal(str(buy))
            total[int(index)][1] += Decimal(str(sell))
    return [[index, float(v[0]), float(v[1])] for index, v in sorted(total.items())]


def build_period(label: str, expected_days, daily_payloads: dict[str, dict], failed_days=None) -> dict:
    expected = [day.isoformat() if hasattr(day, "isoformat") else str(day) for day in expected_days]
    days = [day for day in expected if day in daily_payloads]
    missing = [day for day in expected if day not in daily_payloads]
    payloads = [daily_payloads[day] for day in days]
    return {
        "label": label,
        "expectedDays": expected,
        "days": days,
        "missingDays": missing,
        "failedDays": sorted(set(failed_days or []).intersection(expected)),
        "complete": len(missing) == 0,
        "rows": combine_ladders(payloads),
    }
