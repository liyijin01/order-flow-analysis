from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.c4_1_golden import Bar
from scripts.d16_build_tpo import build_symbol, profile_from_bars

ROOT=Path(__file__).resolve().parents[2]
FIXTURE=ROOT/"web/tests/fixtures/tpo-consistency.json"


class D16TpoTests(unittest.TestCase):
    def test_python_profile_matches_shared_fixture(self):
        fx=json.loads(FIXTURE.read_text(encoding="utf-8"))
        bars=[Bar(int(x["openTime"]),x["open"],x["high"],x["low"],x["close"],x["volume"],x["takerBuyBase"]) for x in fx["bars"]]
        got=profile_from_bars(fx["symbol"],bars)
        exp=fx["expected"]
        self.assertEqual(got["rows"],exp["rows"])
        for key in ("poc","vah","val","high","low"):
            self.assertEqual(got[key],exp[key])

    def test_js_and_python_match_all_fixtures(self):
        fixtures=[
            ROOT/"web/tests/fixtures/tpo-consistency.json",
            ROOT/"web/tests/fixtures/btcusdt-um-1M-2026-10-01.json",
        ]
        node_script=r"""
const fs=require('fs');
(async()=>{
  await import('./web/shared/value-area.js');
  const fx=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
  const rowSize=Number(fx.rowSize||10);
  const got=globalThis.OrderFlowValueArea.tpoProfile(fx.bars,rowSize);
  process.stdout.write(JSON.stringify(got));
})().catch(error=>{console.error(error);process.exit(1);});
"""
        for fixture in fixtures:
            fx=json.loads(fixture.read_text(encoding="utf-8"))
            bars=[
                Bar(
                    int(x["openTime"]),
                    x["open"],x["high"],x["low"],x["close"],x["volume"],x["takerBuyBase"]
                )
                for x in fx["bars"]
            ]
            py_profile=profile_from_bars(fx.get("symbol","BTCUSDT"),bars)
            result=subprocess.run(
                ["node","-e",node_script,str(fixture)],
                cwd=ROOT,
                check=True,
                capture_output=True,
                text=True,
            )
            js_profile=json.loads(result.stdout)
            self.assertEqual(js_profile["rows"],py_profile["rows"],fixture.name)
            for key in ("poc","vah","val"):
                self.assertEqual(js_profile[key],py_profile[key],fixture.name)

    def test_incomplete_month_is_not_cached(self):
        from datetime import datetime, timezone
        cutoff=datetime(2026,10,5,tzinfo=timezone.utc)
        def fake_load(_symbol,_market,_interval,start,end):
            step=1_800_000
            total=int((end-start).total_seconds()*1000//step)
            return [Bar(int(start.timestamp()*1000)+i*step,100,101,99,100,1,.5) for i in range(max(0,total-1))]
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);payload,computed=build_symbol("BTCUSDT",cutoff,root/"cache",root/"out",fake_load)
            self.assertEqual(payload["monthly"],[])
            self.assertEqual(computed,[])
            self.assertFalse((root/"cache"/"monthly").exists())


if __name__=="__main__":
    unittest.main()
