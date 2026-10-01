from __future__ import annotations


def value_area(rows, bin_size: float, pct: float = .70):
    rows = sorted((float(p), float(v)) for p, v in rows)
    if not rows:
        return None
    total = sum(v for _, v in rows)
    if total <= 0:
        return None
    midpoint = (rows[0][0] + rows[-1][0] + bin_size) / 2
    maxv = max(v for _, v in rows)
    candidates = [i for i, (_, v) in enumerate(rows) if v == maxv]
    poc = min(candidates, key=lambda i: abs((rows[i][0] + bin_size / 2) - midpoint))
    lo = hi = poc
    acc = rows[poc][1]
    target = total * pct
    while acc < target and (lo > 0 or hi < len(rows) - 1):
        up = rows[hi + 1][1] if hi < len(rows) - 1 else -1
        dn = rows[lo - 1][1] if lo > 0 else -1
        if up >= dn and hi < len(rows) - 1:
            hi += 1
            acc += rows[hi][1]
        elif lo > 0:
            lo -= 1
            acc += rows[lo][1]
        else:
            hi += 1
            acc += rows[hi][1]
    return {
        "poc": rows[poc][0] + bin_size / 2,
        "vah": rows[hi][0] + bin_size,
        "val": rows[lo][0],
        "included": acc,
        "total": total,
    }
