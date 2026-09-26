import io
import unittest

from pipeline.ladder import parse_aggtrades_csv, price_to_bin_index


class LadderTests(unittest.TestCase):
    def test_header_csv_maps_maker_true_to_taker_sell(self):
        csv_text = (
            "agg_trade_id,price,quantity,first_trade_id,last_trade_id,transact_time,is_buyer_maker\n"
            "1,100.25,2.5,10,11,1000,true\n"
            "2,100.75,1.5,12,12,1001,false\n"
        )
        ladder, trades = parse_aggtrades_csv(io.StringIO(csv_text), "1")
        self.assertEqual(trades, 2)
        self.assertEqual(ladder[100], [1.5, 2.5])

    def test_headerless_csv_maps_maker_true_to_taker_sell(self):
        csv_text = (
            "1,100.25,2.5,10,11,1000,true\n"
            "2,101.10,1.5,12,12,1001,false\n"
        )
        ladder, _ = parse_aggtrades_csv(io.StringIO(csv_text), "1")
        self.assertEqual(ladder[100], [0, 2.5])
        self.assertEqual(ladder[101], [1.5, 0])

    def test_decimal_ladder_separates_low_prices(self):
        self.assertEqual(price_to_bin_index("0.4210", "0.01"), 42)
        self.assertEqual(price_to_bin_index("0.5371", "0.01"), 53)
        self.assertEqual(price_to_bin_index("0.5480", "0.01"), 54)


if __name__ == "__main__":
    unittest.main()
